# Enhanced Agent Templates

This directory contains enhanced agent templates that demonstrate the new skill system with intelligent routing, argument substitution, and execution modes.

## Available Templates

### 1. Sales Assistant Enhanced (`sales-agent-enhanced.yaml`)
**Use Case**: Sales teams and customer relationship management
**Key Features**:
- Lead qualification with `/qualify` trigger
- Product recommendations with `/recommend` trigger  
- Follow-up management with `/followup` trigger
- Complex deal analysis with fork mode
- Argument substitution for customer data

**Example Usage**:
```
User: /qualify Tech Corp lead - budget $50k, timeline Q3, need CRM integration
Agent: Qualifying lead for Tech Corp from Tech Corp. Budget: $50k. Timeline: Q3. Use case: CRM integration.
```

### 2. DevOps Assistant Enhanced (`devops-agent-enhanced.yaml`)
**Use Case**: DevOps teams and infrastructure management
**Key Features**:
- Deployment management with `/deploy` trigger
- Infrastructure provisioning with `/provision` trigger
- Monitoring setup with `/monitor` trigger
- Troubleshooting with `/troubleshoot` trigger
- Security scanning with fork mode for complex operations

**Example Usage**:
```
User: /deploy webapp to production using blue-green strategy
Agent: Deploy webapp to production. Strategy: blue-green. Version: latest. Region: us-west-2.
```

### 3. Customer Support Enhanced (`support-agent-enhanced.yaml`)
**Use Case**: Customer support teams and help desks
**Key Features**:
- Ticket management with `/ticket` trigger
- Knowledge base search with `/search` trigger
- Customer communication with `/email` trigger
- Escalation management with `/escalate` trigger
- FAQ and documentation access

**Example Usage**:
```
User: /ticket #12345 - customer reports login issue, priority high
Agent: Managing ticket #12345 for John Doe. Issue: login problems. Priority: high. Category: authentication.
```

### 4. Test Manual Enhanced (`test-manual-enhanced.yaml`)
**Use Case**: E2E testing and development
**Key Features**:
- Mixed legacy and enhanced skills
- Argument substitution examples
- Both inline and fork execution modes
- Discovery tools enabled

## Enhanced Features

### 🎯 Trigger Commands
Each skill supports specific trigger commands:
- `/deploy`, `/release`, `/rollout` - Deployment operations
- `/qualify`, `/lead`, `/assess` - Lead qualification
- `/troubleshoot`, `/debug`, `/incident` - Issue resolution
- `/escalate`, `/urgent` - Escalation management

### 🔤 Argument Substitution
Skills support flexible argument substitution:
- `$ARGUMENTS` - All provided arguments
- `$ARG_NAME` - Named arguments (case-insensitive)
- `$ARG_1`, `$ARG_2` - Positional arguments

### ⚡ Execution Modes
- **Inline Mode** - Integrated with current system (default)
- **Fork Mode** - Isolated execution for complex operations

### 🧠 Intelligent Routing
- **Trigger-based** - Direct command matching
- **Priority-based** - Fallback when no trigger matches
- **Context-aware** - LLM-guided selection (future)

## Usage Instructions

### 1. Copy Template
```bash
cp templates/sales-agent-enhanced.yaml runtime/my-sales-agent.yaml
```

### 2. Customize Configuration
Edit the copied file to match your specific needs:
- Update `name`, `description`, and `systemPrompt`
- Modify `skills` based on your use cases
- Configure `tools` with your actual endpoints
- Adjust `llm` settings for your preferred model

### 3. Enable Enhanced Features
Make sure these flags are set to `true`:
```yaml
enableEnhancedSkills: true
enableSkillRouting: true
enableDiscoveryTools: true
```

### 4. Test the Agent
Use trigger commands to test skills:
```bash
# Test sales agent
/qualify lead from Acme Corp, budget $100k

# Test DevOps agent  
/deploy microservice to staging using canary strategy

# Test support agent
/ticket #67890 - customer reports payment issue
```

## Migration from Legacy

### Legacy Skill Format
```yaml
skills:
  - id: my-skill
    name: my_skill
    description: My skill
    instructions: Do something
    allowedTools: [tool1]
```

### Enhanced Skill Format (Auto-Migrated)
```yaml
skills:
  - id: my-skill
    name: my_skill
    description: My skill
    instructions: "Do something with $PARAMETER"
    when_to_use: "Use when you need to do something"
    triggers: ["/do", "/something"]
    arguments: ["parameter"]
    allowedTools: [tool1]
    context_mode: inline
    priority: 0
```

## Best Practices

### 1. Skill Design
- **Clear `when_to_use`**: Help the LLM understand when to use the skill
- **Specific triggers**: Use intuitive command names
- **Well-defined arguments**: List all parameters the skill accepts
- **Appropriate execution mode**: Use fork mode for complex operations

### 2. Argument Naming
- Use descriptive names: `customer_name` vs `name`
- Use consistent naming across skills
- Provide clear examples in skill descriptions

### 3. Priority Setting
- **High priority (8-10)**: Core business functions
- **Medium priority (5-7)**: Supporting tasks  
- **Low priority (0-4)**: Optional or utility functions

### 4. Tool Integration
- Configure actual endpoints for your tools
- Use authentication headers with environment variables
- Test tool connectivity before using in production

## Troubleshooting

### Skills Not Triggering
1. Check trigger spelling and format
2. Verify `enableSkillRouting: true`
3. Ensure skill is `enabled: true`

### Arguments Not Substituting
1. Check argument names in `arguments` list
2. Verify `$ARG_NAME` matches arguments (case-insensitive)
3. Use `$ARGUMENTS` for all provided args

### Fork Mode Not Working
1. Verify `context_mode: fork` in skill definition
2. Check `modelOverride` if specified
3. Ensure tool registry has required tools

## Feature Flags

Control enhanced features with these flags:
- `enableEnhancedSkills`: Use new skill system
- `enableSkillRouting`: Enable trigger-based routing  
- `enableDiscoveryTools`: Register SelectSkill/ListSkills tools

Set to `false` for gradual rollout or fallback to legacy behavior.
