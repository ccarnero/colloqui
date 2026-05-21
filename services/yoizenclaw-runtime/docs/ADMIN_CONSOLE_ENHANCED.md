# Admin Console Enhanced Integration

Guía para adaptar el admin console existente al nuevo sistema enhanced skills.

## 🎯 Objetivo

Adaptar el admin console actual (que usa NATS config sync) para soportar el nuevo formato enhanced skills sin romper la funcionalidad existente.

## 📡 Endpoints HTTP Disponibles

El admin console puede usar estos endpoints HTTP en lugar de NATS directamente:

### Configuración de Agents

#### `GET /config/agents`
Listar todos los agentes configurados

```javascript
// Response
{
  "agents": {
    "sales-agent": { /* enhanced config */ },
    "support-agent": { /* legacy config */ }
  },
  "count": 2
}
```

#### `GET /config/agents/{agent_id}`
Obtener configuración específica de un agente

```javascript
// Response
{
  "agent_id": "sales-agent",
  "config": {
    "name": "Sales Assistant Enhanced",
    "enableEnhancedSkills": true,
    "skills": [
      {
        "id": "qualify-lead",
        "triggers": ["/qualify", "/lead"],
        "arguments": ["lead_name", "budget"]
      }
    ]
  }
}
```

#### `POST /config/agents/{agent_id}`
Actualizar configuración de un agente

```javascript
// Request Body (Enhanced)
{
  "name": "Sales Assistant Enhanced",
  "role": {
    "systemPrompt": "You are a professional sales assistant."
  },
  "skills": [
    {
      "id": "qualify-lead",
      "name": "qualify_lead_skill",
      "instructions": "Qualify lead for $LEAD_NAME from $COMPANY. Budget: $BUDGET.",
      "when_to_use": "Use when qualifying sales leads",
      "triggers": ["/qualify", "/lead"],
      "arguments": ["lead_name", "company", "budget"],
      "context_mode": "inline",
      "priority": 10
    }
  ],
  "enableEnhancedSkills": true,
  "enableSkillRouting": true,
  "enableDiscoveryTools": true
}
```

#### `DELETE /config/agents/{agent_id}`
Eliminar un agente

### Herramientas Enhanced

#### `GET /api/agents/templates`
Obtener templates predefinidos para facilitar la creación

```javascript
// Response
{
  "agent_templates": {
    "sales_agent": {
      "name": "Sales Assistant",
      "skills": ["qualify", "recommend", "followup"]
    },
    "devops_agent": {
      "name": "DevOps Assistant", 
      "skills": ["deploy", "monitor", "troubleshoot"]
    }
  },
  "skill_templates": {
    "deploy": {
      "name": "deploy_skill",
      "triggers": ["/deploy", "/release"],
      "arguments": ["component", "environment", "version"],
      "context_mode": "fork"
    }
  }
}
```

#### `POST /api/agents/validate`
Validar configuración antes de guardar

```javascript
// Request
{
  "name": "Test Agent",
  "skills": [...],
  "enableEnhancedSkills": true
}

// Response
{
  "valid": true,
  "type": "enhanced",
  "warnings": [],
  "skills_count": 3,
  "tools_count": 5
}
```

## 🔄 Migración del Admin Console

### Paso 1: Detectar Enhanced Skills

```javascript
// En tu admin console, detecta si el agente usa enhanced features
function isEnhancedAgent(agentConfig) {
  return agentConfig.enableEnhancedSkills || 
         agentConfig.skills?.some(skill => 
           skill.triggers || skill.when_to_use || skill.arguments
         );
}
```

### Paso 2: UI Adaptativa

```javascript
// Muestra diferentes UI basado en el tipo de agente
function renderAgentForm(agentConfig) {
  const isEnhanced = isEnhancedAgent(agentConfig);
  
  return `
    <div class="agent-form">
      <!-- Campos básicos (siempre) -->
      <input name="name" value="${agentConfig.name || ''}" />
      <textarea name="role.systemPrompt">${agentConfig.role?.systemPrompt || ''}</textarea>
      
      ${isEnhanced ? `
        <!-- Enhanced Features -->
        <div class="enhanced-section">
          <h3>Enhanced Skills</h3>
          <label>
            <input type="checkbox" name="enableEnhancedSkills" checked />
            Enable Enhanced Skills
          </label>
          <label>
            <input type="checkbox" name="enableSkillRouting" checked />
            Enable Skill Routing
          </label>
          
          <div class="skills-list">
            ${agentConfig.skills?.map(renderEnhancedSkill).join('') || ''}
          </div>
          
          <button type="button" onclick="addEnhancedSkill()">+ Add Skill</button>
        </div>
      ` : `
        <!-- Legacy Skills -->
        <div class="legacy-section">
          <h3>Skills (Legacy)</h3>
          <div class="skills-list">
            ${agentConfig.skills?.map(renderLegacySkill).join('') || ''}
          </div>
        </div>
      `}
    </div>
  `;
}
```

### Paso 3: Enhanced Skill Editor

```javascript
function renderEnhancedSkill(skill, index) {
  return `
    <div class="enhanced-skill" data-index="${index}">
      <input name="skills[${index}].name" value="${skill.name || ''}" placeholder="Skill Name" />
      <textarea name="skills[${index}].instructions" placeholder="Instructions with $ARGUMENTS">${skill.instructions || ''}</textarea>
      
      <!-- Enhanced Fields -->
      <input name="skills[${index}].when_to_use" value="${skill.when_to_use || ''}" placeholder="When to use this skill" />
      
      <div class="triggers">
        <label>Triggers:</label>
        <input name="skills[${index}].triggers" value="${skill.triggers?.join(', ') || ''}" placeholder="/deploy, /release" />
      </div>
      
      <div class="arguments">
        <label>Arguments:</label>
        <input name="skills[${index}].arguments" value="${skill.arguments?.join(', ') || ''}" placeholder="component, environment, version" />
      </div>
      
      <div class="execution-mode">
        <label>Execution Mode:</label>
        <select name="skills[${index}].context_mode">
          <option value="inline" ${skill.context_mode === 'inline' ? 'selected' : ''}>Inline</option>
          <option value="fork" ${skill.context_mode === 'fork' ? 'selected' : ''}>Fork</option>
        </select>
      </div>
      
      <div class="priority">
        <label>Priority:</label>
        <input type="number" name="skills[${index}].priority" value="${skill.priority || 0}" min="0" max="10" />
      </div>
      
      <button type="button" onclick="removeSkill(${index})">Remove</button>
    </div>
  `;
}
```

### Paso 4: Templates Integration

```javascript
// Cargar templates para facilitar la creación
async function loadTemplates() {
  const response = await fetch('/api/agents/templates');
  const templates = await response.json();
  
  // Populate template selector
  const templateSelect = document.getElementById('agent-template');
  templateSelect.innerHTML = Object.entries(templates.agent_templates)
    .map(([key, template]) => 
      `<option value="${key}">${template.name}</option>`
    ).join('');
  
  // Store skill templates for later use
  window.skillTemplates = templates.skill_templates;
}

// Add skill from template
function addSkillFromTemplate(skillType) {
  const template = window.skillTemplates[skillType];
  if (!template) return;
  
  const skillsContainer = document.getElementById('skills-container');
  const skillCount = skillsContainer.children.length;
  
  const skillHtml = renderEnhancedSkill({
    ...template,
    id: `skill-${Date.now()}`
  }, skillCount);
  
  skillsContainer.insertAdjacentHTML('beforeend', skillHtml);
}
```

### Paso 5: Validación y Guardado

```javascript
async function saveAgent(agentId, config) {
  try {
    // Validar primero
    const validation = await fetch('/api/agents/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    }).then(r => r.json());
    
    if (!validation.valid) {
      alert(`Configuration invalid: ${validation.error}`);
      return;
    }
    
    // Guardar configuración
    const response = await fetch(`/config/agents/${agentId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    }).then(r => r.json());
    
    if (response.success) {
      alert('Agent saved successfully!');
      loadAgents(); // Reload list
    } else {
      alert(`Failed to save: ${response.message}`);
    }
  } catch (error) {
    alert(`Error saving agent: ${error.message}`);
  }
}
```

## 🎨 UI Components Sugeridos

### Enhanced Skill Card

```html
<div class="skill-card enhanced">
  <div class="skill-header">
    <h3>${skill.name}</h3>
    <div class="skill-badges">
      <span class="badge trigger">${skill.triggers?.[0] || 'No trigger'}</span>
      <span class="badge mode">${skill.context_mode}</span>
      <span class="badge priority">Priority ${skill.priority}</span>
    </div>
  </div>
  
  <div class="skill-content">
    <p class="instructions">${skill.instructions}</p>
    <p class="when-to-use">${skill.when_to_use}</p>
    
    <div class="skill-details">
      <div class="arguments">
        <strong>Arguments:</strong> ${skill.arguments?.join(', ') || 'None'}
      </div>
      <div class="tools">
        <strong>Tools:</strong> ${skill.allowed_tools?.join(', ') || 'None'}
      </div>
    </div>
  </div>
</div>
```

### Template Selector

```html
<div class="template-selector">
  <h3>Quick Start Templates</h3>
  <div class="template-grid">
    <div class="template-card" onclick="applyTemplate('sales_agent')">
      <h4>💼 Sales Agent</h4>
      <p>Lead qualification, recommendations, follow-ups</p>
      <div class="template-features">
        <span>🎯 3 Skills</span>
        <span>⚡ Triggers</span>
        <span>🔧 Arguments</span>
      </div>
    </div>
    
    <div class="template-card" onclick="applyTemplate('devops_agent')">
      <h4>🔧 DevOps Agent</h4>
      <p>Deployments, monitoring, troubleshooting</p>
      <div class="template-features">
        <span>🎯 3 Skills</span>
        <span>⚡ Fork Mode</span>
        <span>🔧 Arguments</span>
      </div>
    </div>
    
    <div class="template-card" onclick="applyTemplate('support_agent')">
      <h4>🎧 Support Agent</h4>
      <p>Ticket management, knowledge base, communication</p>
      <div class="template-features">
        <span>🎯 3 Skills</span>
        <span>⚡ Triggers</span>
        <span>🔧 Arguments</span>
      </div>
    </div>
  </div>
</div>
```

## 🔄 Compatibilidad Backward

### Auto-migración

El sistema automáticamente convierte skills legacy al formato enhanced:

```javascript
// Legacy skill (existente)
{
  "id": "legacy-skill",
  "name": "legacy_skill", 
  "instructions": "Do something",
  "allowedTools": ["tool1"]
}

// Auto-migrado a enhanced
{
  "id": "legacy-skill",
  "name": "legacy_skill",
  "instructions": "Do something",
  "when_to_use": "",           // Auto-added
  "triggers": [],              // Auto-added
  "arguments": [],             // Auto-added
  "context_mode": "inline",    // Auto-added
  "priority": 0,               // Auto-added
  "allowedTools": ["tool1"]
}
```

### Feature Flags

Los usuarios pueden deshabilitar enhanced features si lo necesitan:

```javascript
// En el admin console
{
  "enableEnhancedSkills": false,  // Deshabilitar todo
  "enableSkillRouting": false,    // Solo triggers
  "enableDiscoveryTools": false   // Sin discovery tools
}
```

## 🚀 Beneficios para el Admin Console

1. **✅ Backward Compatible** - Agents existentes siguen funcionando
2. **🎯 Templates Predefinidos** - Creación rápida de agents enhanced
3. **🔧 Validación Automática** - Previene configuraciones inválidas
4. **⚡ HTTP Endpoints** - Más fácil que NATS para frontend
5. **🧠 UI Inteligente** - Se adapta según el tipo de agent
6. **🔄 Migración Gradual** - Los usuarios pueden activar enhanced cuando quieran

## 📋 Checklist de Implementación

- [ ] Agregar detección de enhanced features
- [ ] Implementar UI adaptativa
- [ ] Integrar templates endpoint
- [ ] Agregar enhanced skill editor
- [ ] Implementar validación frontend
- [ ] Actualizar flows de guardado
- [ ] Agregar indicadores visuales (badges, etc.)
- [ ] Testing con agents legacy y enhanced

El admin console está listo para soportar el nuevo sistema enhanced skills! 🎉
