# Enhanced Agent Management API

Esta API permite crear y gestionar agentes con el nuevo sistema enhanced skills.

## Endpoints

### POST /api/agents
Crear un nuevo agente con enhanced features.

```json
{
  "name": "Sales Assistant Enhanced",
  "description": "Agent for sales and CRM",
  "role": {
    "name": "Sales Assistant",
    "systemPrompt": "You are a professional sales assistant.",
    "temperature": 0.6,
    "maxTokens": 800
  },
  "rules": ["Be professional", "Qualify leads"],
  "response_style": "Friendly and professional",
  "llm": {
    "provider": "openai",
    "model": "gpt-4"
  },
  "skills": [
    {
      "id": "qualify-lead",
      "name": "qualify_lead_skill",
      "description": "Qualify sales leads",
      "instructions": "Qualify lead for $LEAD_NAME from $COMPANY. Budget: $BUDGET.",
      "when_to_use": "Use when qualifying sales leads",
      "triggers": ["/qualify", "/lead"],
      "arguments": ["lead_name", "company", "budget"],
      "allowedTools": ["crm_tool"],
      "context_mode": "inline",
      "priority": 10
    }
  ],
  "tools": [
    {
      "id": "crm_tool",
      "name": "CRM Tool",
      "description": "Access CRM system",
      "endpoint": "https://api.crm.com/leads",
      "method": "GET",
      "enabled": true
    }
  ],
  "enable_enhanced_skills": true,
  "enable_skill_routing": true,
  "enable_discovery_tools": true
}
```

### GET /api/agents/templates
Obtener templates predefinidos para agentes y skills.

```json
{
  "agent_templates": {
    "sales_agent": {
      "name": "Sales Assistant",
      "description": "Agent for sales and customer relationship management",
      "role": {
        "name": "Sales Assistant",
        "systemPrompt": "You are a professional sales assistant.",
        "temperature": 0.6
      },
      "skills": ["qualify", "recommend", "followup"],
      "default_tools": ["crm_tool", "email_tool"]
    },
    "devops_agent": {
      "name": "DevOps Assistant",
      "description": "Agent for DevOps and infrastructure management",
      "role": {
        "name": "DevOps Assistant",
        "systemPrompt": "You are an expert DevOps assistant.",
        "temperature": 0.3
      },
      "skills": ["deploy", "monitor", "troubleshoot"],
      "default_tools": ["deploy_tool", "k8s_tool", "monitoring_tool"]
    }
  },
  "skill_templates": {
    "deploy": {
      "name": "deploy_skill",
      "description": "Deploy applications to environments",
      "instructions": "Deploy $COMPONENT to $ENVIRONMENT. Version: $VERSION.",
      "when_to_use": "Use when deploying applications or infrastructure",
      "triggers": ["/deploy", "/release", "/rollout"],
      "arguments": ["component", "environment", "version"],
      "context_mode": "fork",
      "priority": 10
    },
    "qualify": {
      "name": "qualify_lead_skill",
      "description": "Qualify sales leads",
      "instructions": "Qualify lead for $LEAD_NAME from $COMPANY. Budget: $BUDGET.",
      "when_to_use": "Use when qualifying sales leads",
      "triggers": ["/qualify", "/lead", "/assess"],
      "arguments": ["lead_name", "company", "budget"],
      "context_mode": "inline",
      "priority": 8
    }
  }
}
```

### POST /api/agents/validate
Validar configuración de agente antes de guardar.

```json
{
  "name": "Test Agent",
  "role": { "systemPrompt": "Test prompt" },
  "skills": [...],
  "enable_enhanced_skills": true
}
```

Response:
```json
{
  "valid": true,
  "type": "enhanced",
  "warnings": [],
  "skills_count": 3,
  "tools_count": 5
}
```

## Características Enhanced

### 🎯 Trigger Commands
Cada skill puede tener comandos directos:
- `/deploy` - Para deployments
- `/qualify` - Para calificación de leads
- `/troubleshoot` - Para resolución de problemas

### 🔤 Argument Substitution
Soporte flexible de argumentos:
- `$COMPONENT` - Argumentos nombrados
- `$ARG_1`, `$ARG_2` - Argumentos posicionales
- `$ARGUMENTS` - Todos los argumentos

### ⚡ Execution Modes
- **inline** - Integrado con el sistema actual
- **fork** - Ejecución aislada para operaciones complejas

### 🧠 Intelligent Routing
- **Trigger-based** - Comandos directos
- **Priority-based** - Fallback automático
- **Context-aware** - Selección guiada por LLM

## Ejemplos de Uso

### 1. Crear Agente de Ventas
```bash
curl -X POST http://localhost:8000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sales Bot",
    "role": {
      "systemPrompt": "Eres un asistente de ventas profesional."
    },
    "skills": [
      {
        "id": "qualify",
        "name": "qualify_lead",
        "instructions": "Calificar lead $LEAD_NAME con presupuesto $BUDGET",
        "triggers": ["/qualify"],
        "arguments": ["lead_name", "budget"],
        "when_to_use": "Usar para calificar leads"
      }
    ],
    "enable_enhanced_skills": true
  }'
```

### 2. Obtener Templates
```bash
curl http://localhost:8000/api/agents/templates
```

### 3. Validar Configuración
```bash
curl -X POST http://localhost:8000/api/agents/validate \
  -H "Content-Type: application/json" \
  -d '{"name": "Test", "role": {"systemPrompt": "Test"}}'
```

## Frontend Sugerido

Para crear una UI simple, puedes usar:

### React/Vue Component
```jsx
function AgentCreator() {
  const [agent, setAgent] = useState({
    name: '',
    role: { systemPrompt: '' },
    skills: [],
    enable_enhanced_skills: true
  });
  
  const addSkill = (template) => {
    setAgent(prev => ({
      ...prev,
      skills: [...prev.skills, { ...template, id: uuid() }]
    }));
  };
  
  return (
    <div>
      <AgentForm agent={agent} onChange={setAgent} />
      <SkillTemplates onSelect={addSkill} />
      <Preview agent={agent} />
    </div>
  );
}
```

### HTML Simple
```html
<form id="agent-form">
  <input name="name" placeholder="Agent Name" />
  <textarea name="role.systemPrompt" placeholder="System Prompt"></textarea>
  
  <div id="skills">
    <h3>Skills</h3>
    <button type="button" onclick="addSkill('deploy')">Add Deploy Skill</button>
    <button type="button" onclick="addSkill('qualify')">Add Qualify Skill</button>
  </div>
  
  <button type="submit">Create Agent</button>
</form>
```

## Próximos Pasos

1. **Implementar persistencia** - Guardar agentes en database
2. **Crear UI real** - Frontend con React/Vue
3. **Añadir testing** - Tests E2E para la API
4. **Documentar** - OpenAPI/Swagger docs
5. **Monitoring** - Métricas de uso de skills

La API está lista para integrarse con cualquier frontend moderno! 🚀
