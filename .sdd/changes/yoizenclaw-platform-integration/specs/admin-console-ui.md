# Delta Specification: admin-console-ui

## ADDED Requirements

### REQ-ADM-UI-001: Agents management page

**Priority**: P0 (Critical)

The system MUST provide a dedicated page in the Admin Console for managing YoizenClaw agents.

**Page requirements**:
- URL: `/agents`
- List view with columns: Name, Status, Model, Channels, Last Updated
- Create button opening a modal/form
- Edit action for each agent
- Publish/Unpublish toggle
- Delete action with confirmation

#### Scenario: View agents list

- GIVEN the user navigates to /agents
- WHEN the page loads
- THEN the list MUST display all agents for the current tenant
- AND show agent name, status badge, model, and associated channels

#### Scenario: Create new agent

- GIVEN the user clicks "Create Agent"
- WHEN the form is submitted with valid data
- THEN the agent MUST be created
- AND the user MUST be redirected to the agents list with success message

### REQ-ADM-UI-002: Agent editor form

**Priority**: P0 (Critical)

The system MUST provide a comprehensive form for creating and editing agents with all configuration options.

**Form sections**:
1. **Basic Info**: Name, Description, Status (draft/published)
2. **LLM Configuration**: Provider (OpenAI, Anthropic, etc.), Model, Temperature, Max Tokens
3. **System Prompt**: Text area with template variables support
4. **Tools**: Multi-select of available tools (catalog, memory, communicate, etc.)
5. **Channels**: Association with channels (webchat, whatsapp, etc.)
6. **Credentials**: Dropdown to select credential profile

#### Scenario: Configure agent with tools

- GIVEN the user is creating a new agent
- WHEN they select tools "catalog", "memory", and "calendar"
- AND save the agent
- THEN the agent configuration MUST include these tools
- AND they MUST be available when the agent responds to chats

#### Scenario: Edit system prompt with templates

- GIVEN the user is editing an agent
- WHEN they modify the system prompt with `{{user_name}}` template
- AND save the changes
- THEN the template MUST be stored
- AND rendered with actual values at runtime

### REQ-ADM-UI-003: Agent publishing workflow

**Priority**: P1 (High)

The system MUST provide a clear workflow for publishing agents to make them active in the runtime.

**Publishing flow**:
1. User clicks "Publish" on a draft agent
2. System validates configuration completeness
3. System publishes to NATS for runtime sync
4. Show success/failure notification
5. Update agent status to "published"

#### Scenario: Publish agent to runtime

- GIVEN agent "sales-assistant" is in "draft" status
- WHEN the user clicks "Publish"
- THEN the system MUST validate all required fields are filled
- AND publish the config to the tenant's runtime
- AND show "Agent published successfully" notification

### REQ-ADM-UI-004: Runtime status dashboard

**Priority**: P2 (Medium)

The system SHOULD provide a dashboard showing the health and status of the tenant's YoizenClaw runtime.

**Dashboard elements**:
- Runtime status indicator (healthy/degraded/offline)
- Last sync timestamp
- Number of agents deployed
- Number of jobs configured
- PostgreSQL connection status
- Recent error logs (last 5)

#### Scenario: View runtime health

- GIVEN the user navigates to /agents/status
- WHEN the page loads
- THEN it MUST show a green indicator if runtime is healthy
- AND display "Last sync: 2 minutes ago"
- AND list all connected agents

## MODIFIED Requirements

### REQ-ADM-UI-005: Navigation menu addition

**Priority**: P1 (High)

The system SHALL add "Agents" to the main navigation menu of the Admin Console.

**Menu item**:
- Icon: Bot/MessageSquare (Lucide)
- Label: "Agents"
- Route: /agents
- Position: After "Dashboard", before "Settings"

#### Scenario: Access agents from navigation

- GIVEN the user is logged into Admin Console
- WHEN they look at the left sidebar
- THEN they MUST see an "Agents" menu item with bot icon
- AND clicking it MUST navigate to /agents

## Non-Functional Requirements

### NFR-UI-001: Page load performance

**Category**: Performance
**Priority**: P1 (High)

The agents page MUST load quickly with good user experience.

- **Metric**: Time to interactive
- **Target**: < 2 seconds for agents list with 50 agents
- **Measurement**: Lighthouse performance audit

### NFR-UI-002: Form validation UX

**Category**: Usability
**Priority**: P2 (Medium)

The agent creation/editing form MUST provide clear validation feedback.

- **Metric**: User error recovery time
- **Target**: Validation errors shown inline, form submission blocked until valid
- **Measurement**: UX testing

### NFR-UI-003: Mobile responsiveness

**Category**: Accessibility
**Priority**: P2 (Medium)

The agents management interface MUST be usable on mobile devices.

- **Metric**: Mobile usability score
- **Target**: All features accessible on 375px width screens
- **Measurement**: Chrome DevTools mobile emulation
