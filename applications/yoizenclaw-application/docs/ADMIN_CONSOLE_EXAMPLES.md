# Admin Console Enhanced Examples

Ejemplos concretos de cómo el admin console existente puede enviar enhanced agent configs usando el sistema NATS actualizado.

## 📡 Formatos Soportados

### 1. Enhanced Agent Config (NUEVO)
```javascript
// Tu admin console puede enviar esto directamente via NATS
const enhancedAgentPayload = {
  agent_config: {
    name: "Sales Assistant Enhanced",
    description: "Sales agent with intelligent routing",
    role: {
      name: "Sales Assistant",
      systemPrompt: "You are a professional sales assistant.",
      temperature: 0.6,
      maxTokens: 800
    },
    rules: ["Be professional", "Qualify leads"],
    responseStyle: "Friendly and helpful",
    llm: {
      provider: "openai",
      model: "gpt-4"
    },
    skills: [
      {
        id: "qualify-lead",
        name: "qualify_lead_skill",
        description: "Qualify sales leads",
        enabled: true,
        instructions: "Qualify lead for $LEAD_NAME from $COMPANY. Budget: $BUDGET. Timeline: $TIMELINE.",
        when_to_use: "Use when you need to qualify a sales lead",
        triggers: ["/qualify", "/lead", "/assess"],
        arguments: ["lead_name", "company", "budget", "timeline"],
        allowedTools: ["crm_tool", "email_tool"],
        context_mode: "inline",
        priority: 10
      },
      {
        id: "recommend-product",
        name: "recommend_product_skill",
        description: "Recommend products based on needs",
        enabled: true,
        instructions: "Recommend products for $CUSTOMER_NEEDS in $INDUSTRY. Budget: $BUDGET_RANGE.",
        when_to_use: "Use when customers need product recommendations",
        triggers: ["/recommend", "/suggest", "/products"],
        arguments: ["customer_needs", "industry", "budget_range"],
        allowedTools: ["catalog_tool", "pricing_tool"],
        context_mode: "fork",
        modelOverride: "claude-3-sonnet",
        priority: 8
      }
    ],
    tools: [
      {
        id: "crm_tool",
        name: "CRM Tool",
        description: "Access CRM system for lead data",
        endpoint: "https://api.crm.com/leads",
        method: "GET",
        enabled: true,
        headers: {
          Authorization: "Bearer ${CRM_TOKEN}"
        }
      },
      {
        id: "catalog_tool",
        name: "Catalog Tool",
        description: "Access product catalog",
        endpoint: "https://api.catalog.com/products",
        method: "GET",
        enabled: true
      }
    ],
    enableEnhancedSkills: true,
    enableSkillRouting: true,
    enableDiscoveryTools: true
  }
};

// Enviar via NATS (mismo método que usas ahora)
natsClient.publish('config_sync', JSON.stringify(enhancedAgentPayload));
```

### 2. Legacy File Sync (SIGUE FUNCIONANDO)
```javascript
// Tu formato actual sigue funcionando sin cambios
const legacyPayload = [
  {
    path: "agents/runtime/sales-agent.yaml",
    content: `
name: Sales Assistant
description: Sales agent
role:
  name: Sales Assistant
  systemPrompt: You are a sales assistant
  temperature: 0.6
  maxTokens: 800
rules: []
responseStyle: ""
llm:
  provider: openai
  model: gpt-4
skills:
  - id: basic-skill
    name: basic_skill
    description: Basic skill
    instructions: Help with sales
    allowedTools: [crm_tool]
tools: []
`
  }
];

// Enviar via NATS (exactamente igual que antes)
natsClient.publish('config_sync', JSON.stringify(legacyPayload));
```

## 🔄 Auto-Migración en Acción

### Legacy Skill → Enhanced Skill
```javascript
// Si envías un agent con skills legacy como estos:
const legacySkills = [
  {
    id: "legacy-skill",
    name: "legacy_skill", 
    description: "Legacy skill",
    instructions: "Deploy application",
    allowedTools: ["deploy_tool"]
  }
];

// El sistema automáticamente los convierte a:
const enhancedSkills = [
  {
    id: "legacy-skill",
    name: "legacy_skill",
    description: "Legacy skill", 
    instructions: "Deploy application",
    when_to_use: "",           // ← Auto-added
    triggers: [],              // ← Auto-added
    arguments: [],             // ← Auto-added
    context_mode: "inline",    // ← Auto-added
    priority: 0,               // ← Auto-added
    allowedTools: ["deploy_tool"]
  }
];
```

## 🎯 Ejemplos Prácticos

### Crear Agente DevOps Enhanced
```javascript
function createDevOpsAgent() {
  return {
    agent_config: {
      name: "DevOps Assistant Enhanced",
      description: "DevOps agent with deployment and monitoring capabilities",
      role: {
        name: "DevOps Assistant",
        systemPrompt: "You are an expert DevOps assistant with deep knowledge of cloud infrastructure.",
        temperature: 0.3,
        maxTokens: 1000
      },
      skills: [
        {
          id: "deploy-service",
          name: "deploy_service_skill",
          description: "Deploy services to environments",
          instructions: "Deploy $SERVICE_NAME to $ENVIRONMENT. Version: $VERSION. Strategy: $STRATEGY.",
          when_to_use: "Use when deploying applications or infrastructure",
          triggers: ["/deploy", "/release", "/rollout"],
          arguments: ["service_name", "environment", "version", "strategy"],
          context_mode: "fork",
          priority: 10
        },
        {
          id: "monitor-system",
          name: "monitor_system_skill", 
          description: "Set up monitoring and alerting",
          instructions: "Configure monitoring for $SERVICE_NAME. Metrics: $METRICS. Alerting: $ALERTING.",
          when_to_use: "Use when setting up monitoring or observability",
          triggers: ["/monitor", "/alert", "/metrics"],
          arguments: ["service_name", "metrics", "alerting"],
          context_mode: "inline",
          priority: 7
        },
        {
          id: "troubleshoot-issue",
          name: "troubleshoot_issue_skill",
          description: "Troubleshoot system issues",
          instructions: "Troubleshoot $ISSUE_TYPE in $SERVICE_NAME. Error: $ERROR. Environment: $ENVIRONMENT.",
          when_to_use: "Use when troubleshooting technical issues",
          triggers: ["/troubleshoot", "/debug", "/incident"],
          arguments: ["issue_type", "service_name", "error", "environment"],
          context_mode: "inline",
          priority: 9
        }
      ],
      tools: [
        {
          id: "deploy_tool",
          name: "Deploy Tool",
          endpoint: "https://api.deploy.com/execute",
          method: "POST"
        },
        {
          id: "monitoring_tool",
          name: "Monitoring Tool", 
          endpoint: "https://api.monitoring.com/setup",
          method: "POST"
        }
      ],
      enableEnhancedSkills: true,
      enableSkillRouting: true,
      enableDiscoveryTools: true
    }
  };
}
```

### Crear Agente Support Enhanced
```javascript
function createSupportAgent() {
  return {
    agent_config: {
      name: "Customer Support Enhanced",
      description: "Support agent with ticket management and knowledge base",
      role: {
        name: "Customer Support Agent",
        systemPrompt: "You are a helpful customer support agent. Always be empathetic and solution-focused.",
        temperature: 0.7,
        maxTokens: 600
      },
      skills: [
        {
          id: "manage-ticket",
          name: "manage_ticket_skill",
          description: "Manage customer support tickets",
          instructions: "Manage ticket #$TICKET_ID for $CUSTOMER_NAME. Issue: $ISSUE. Priority: $PRIORITY.",
          when_to_use: "Use when creating, updating, or managing support tickets",
          triggers: ["/ticket", "/case", "/issue"],
          arguments: ["ticket_id", "customer_name", "issue", "priority"],
          context_mode: "inline",
          priority: 10
        },
        {
          id: "search-knowledge",
          name: "search_knowledge_skill",
          description: "Search knowledge base for solutions",
          instructions: "Search knowledge base for $QUERY in $CATEGORY. Keywords: $KEYWORDS.",
          when_to_use: "Use when searching for solutions or documentation",
          triggers: ["/search", "/kb", "/knowledge", "/docs"],
          arguments: ["query", "category", "keywords"],
          context_mode: "inline",
          priority: 8
        },
        {
          id: "escalate-issue",
          name: "escalate_issue_skill",
          description: "Escalate urgent issues",
          instructions: "Escalate issue $ISSUE_TYPE for $CUSTOMER_NAME. Severity: $SEVERITY. Reason: $REASON.",
          when_to_use: "Use when escalating issues to higher support levels",
          triggers: ["/escalate", "/urgent", "/escalation"],
          arguments: ["issue_type", "customer_name", "severity", "reason"],
          context_mode: "fork",
          priority: 9
        }
      ],
      enableEnhancedSkills: true,
      enableSkillRouting: true,
      enableDiscoveryTools: true
    }
  };
}
```

## 🎮 UI Integration Examples

### React Component para Enhanced Agent Creator
```jsx
function EnhancedAgentCreator() {
  const [agent, setAgent] = useState({
    name: '',
    role: { systemPrompt: '' },
    skills: [],
    enableEnhancedSkills: true,
    enableSkillRouting: true,
    enableDiscoveryTools: true
  });

  const addEnhancedSkill = (template) => {
    const newSkill = {
      id: `skill-${Date.now()}`,
      name: template.name,
      instructions: template.instructions,
      when_to_use: template.when_to_use,
      triggers: template.triggers,
      arguments: template.arguments,
      context_mode: template.context_mode,
      priority: template.priority
    };
    
    setAgent(prev => ({
      ...prev,
      skills: [...prev.skills, newSkill]
    }));
  };

  const saveAgent = async () => {
    const payload = {
      agent_config: agent
    };
    
    // Usar tu método NATS existente
    await natsClient.publish('config_sync', JSON.stringify(payload));
  };

  return (
    <div>
      <h2>Create Enhanced Agent</h2>
      
      {/* Basic Info */}
      <input 
        placeholder="Agent Name" 
        value={agent.name}
        onChange={(e) => setAgent({...agent, name: e.target.value})}
      />
      
      {/* Enhanced Features */}
      <label>
        <input 
          type="checkbox" 
          checked={agent.enableEnhancedSkills}
          onChange={(e) => setAgent({...agent, enableEnhancedSkills: e.target.checked})}
        />
        Enable Enhanced Skills
      </label>
      
      {/* Skills */}
      <div className="skills-section">
        <h3>Skills</h3>
        {agent.skills.map((skill, index) => (
          <EnhancedSkillEditor 
            key={skill.id}
            skill={skill}
            onChange={(updatedSkill) => {
              const newSkills = [...agent.skills];
              newSkills[index] = updatedSkill;
              setAgent({...agent, skills: newSkills});
            }}
          />
        ))}
        
        <button onClick={() => addEnhancedSkill(devopsTemplates.deploy)}>
          + Add Deploy Skill
        </button>
        <button onClick={() => addEnhancedSkill(supportTemplates.ticket)}>
          + Add Support Skill
        </button>
      </div>
      
      <button onClick={saveAgent}>Save Agent</button>
    </div>
  );
}
```

### Enhanced Skill Editor Component
```jsx
function EnhancedSkillEditor({ skill, onChange }) {
  return (
    <div className="skill-editor">
      <h4>{skill.name || 'New Skill'}</h4>
      
      <input 
        placeholder="Skill Name"
        value={skill.name || ''}
        onChange={(e) => onChange({...skill, name: e.target.value})}
      />
      
      <textarea 
        placeholder="Instructions (use $ARGUMENTS)"
        value={skill.instructions || ''}
        onChange={(e) => onChange({...skill, instructions: e.target.value})}
      />
      
      {/* Enhanced Fields */}
      <input 
        placeholder="When to use this skill"
        value={skill.when_to_use || ''}
        onChange={(e) => onChange({...skill, when_to_use: e.target.value})}
      />
      
      <input 
        placeholder="Triggers (comma separated)"
        value={skill.triggers?.join(', ') || ''}
        onChange={(e) => onChange({...skill, triggers: e.target.value.split(',').map(t => t.trim())})}
      />
      
      <input 
        placeholder="Arguments (comma separated)"
        value={skill.arguments?.join(', ') || ''}
        onChange={(e) => onChange({...skill, arguments: e.target.value.split(',').map(a => a.trim())})}
      />
      
      <select 
        value={skill.context_mode || 'inline'}
        onChange={(e) => onChange({...skill, context_mode: e.target.value})}
      >
        <option value="inline">Inline Mode</option>
        <option value="fork">Fork Mode</option>
      </select>
      
      <input 
        type="number"
        placeholder="Priority (0-10)"
        min="0"
        max="10"
        value={skill.priority || 0}
        onChange={(e) => onChange({...skill, priority: parseInt(e.target.value)})}
      />
    </div>
  );
}
```

## 🔄 Migration Path

### Paso 1: Sin cambios (Legacy)
```javascript
// Tu código actual sigue funcionando
natsClient.publish('config_sync', JSON.stringify(legacyFilesArray));
```

### Paso 2: Enhanced Features (Opcional)
```javascript
// Comienza a usar enhanced features cuando quieras
const enhancedPayload = {
  agent_config: {
    // ... enhanced config
  }
};
natsClient.publish('config_sync', JSON.stringify(enhancedPayload));
```

### Paso 3: Mix and Match
```javascript
// Puedes tener algunos agents enhanced y otros legacy
// El sistema detecta automáticamente el formato
```

## 🎯 Benefits Inmediatos

1. **✅ Zero Breaking Changes** - Tu código actual sigue funcionando
2. **🚀 Enhanced Features** - Triggers, arguments, fork mode cuando quieras
3. **🔄 Auto-Migration** - Skills legacy se convierten automáticamente
4. **📊 Better Monitoring** - Logs mejorados para enhanced configs
5. **🧠 Validation** - Configuraciones inválidas se detectan antes

**Puedes empezar a usar enhanced features HOY MISMO sin cambiar tu infraestructura!** 🎉
