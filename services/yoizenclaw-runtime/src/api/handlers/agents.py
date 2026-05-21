"""Handlers for agent management API endpoints."""

from fastapi import HTTPException
from pydantic import BaseModel
from typing import Any, Dict, List, Literal, Optional

from src.utils.config.agent_config import EnhancedAgentSyncRequest, AgentSyncRequest


class AgentCreateRequest(BaseModel):
    """Request model for creating agents."""

    name: str
    description: str = ""
    role: Dict[str, Any]
    rules: List[str] = []
    response_style: str = ""
    llm: Dict[str, Any] = {}
    skills: List[Dict[str, Any]] = []
    tools: List[Dict[str, Any]] = []
    enable_enhanced_skills: bool = True
    enable_skill_routing: bool = True
    enable_discovery_tools: bool = True


class AgentResponse(BaseModel):
    """Response model for agent data."""

    id: str
    name: str
    description: str
    role: Dict[str, Any]
    rules: List[str]
    response_style: str
    llm: Dict[str, Any]
    skills: List[Dict[str, Any]]
    tools: List[Dict[str, Any]]
    enable_enhanced_skills: bool
    enable_skill_routing: bool
    enable_discovery_tools: bool
    created_at: str
    updated_at: str


class SkillTemplate(BaseModel):
    """Template for creating enhanced skills."""

    name: str
    description: str
    instructions: str
    when_to_use: str = ""
    triggers: List[str] = []
    arguments: List[str] = []
    allowed_tools: List[str] = []
    context_mode: Literal["inline", "fork"] = "inline"
    priority: int = 0
    model_override: Optional[str] = None


# Enhanced skill templates for UI
SKILL_TEMPLATES = {
    "deploy": SkillTemplate(
        name="deploy_skill",
        description="Deploy applications to environments",
        instructions="Deploy $COMPONENT to $ENVIRONMENT. Version: $VERSION. Strategy: $STRATEGY.",
        when_to_use="Use when deploying applications or infrastructure",
        triggers=["/deploy", "/release", "/rollout"],
        arguments=["component", "environment", "version", "strategy"],
        context_mode="fork",
        priority=10,
    ),
    "qualify": SkillTemplate(
        name="qualify_lead_skill",
        description="Qualify sales leads",
        instructions="Qualify lead for $LEAD_NAME from $COMPANY. Budget: $BUDGET. Timeline: $TIMELINE.",
        when_to_use="Use when qualifying sales leads",
        triggers=["/qualify", "/lead", "/assess"],
        arguments=["lead_name", "company", "budget", "timeline"],
        context_mode="inline",
        priority=8,
    ),
    "troubleshoot": SkillTemplate(
        name="troubleshoot_skill",
        description="Troubleshoot system issues",
        instructions="Troubleshoot $ISSUE_TYPE in $SERVICE_NAME. Error: $ERROR. Environment: $ENVIRONMENT.",
        when_to_use="Use when troubleshooting technical issues",
        triggers=["/troubleshoot", "/debug", "/incident"],
        arguments=["issue_type", "service_name", "error", "environment"],
        context_mode="inline",
        priority=9,
    ),
    "monitor": SkillTemplate(
        name="monitor_skill",
        description="Set up monitoring and alerting",
        instructions="Configure monitoring for $SERVICE_NAME. Metrics: $METRICS. Alerting: $ALERTING.",
        when_to_use="Use when setting up monitoring",
        triggers=["/monitor", "/alert", "/metrics"],
        arguments=["service_name", "metrics", "alerting"],
        context_mode="inline",
        priority=6,
    ),
}


async def create_agent(request: AgentCreateRequest) -> AgentResponse:
    """Create a new agent with enhanced features."""
    raise NotImplementedError(
        "Agent persistence not yet implemented. "
        "Use the NATS config sync endpoint to manage agents."
    )


async def get_agent_templates() -> Dict[str, Any]:
    """Get available agent templates and skill templates."""
    return {
        "agent_templates": {
            "sales_agent": {
                "name": "Sales Assistant",
                "description": "Agent for sales and customer relationship management",
                "role": {
                    "name": "Sales Assistant",
                    "systemPrompt": "You are a professional sales assistant.",
                    "temperature": 0.6,
                },
                "skills": ["qualify", "recommend", "followup"],
                "default_tools": ["crm_tool", "email_tool"],
            },
            "devops_agent": {
                "name": "DevOps Assistant",
                "description": "Agent for DevOps and infrastructure management",
                "role": {
                    "name": "DevOps Assistant",
                    "systemPrompt": "You are an expert DevOps assistant.",
                    "temperature": 0.3,
                },
                "skills": ["deploy", "monitor", "troubleshoot"],
                "default_tools": ["deploy_tool", "k8s_tool", "monitoring_tool"],
            },
            "support_agent": {
                "name": "Customer Support",
                "description": "Agent for customer support and help desk",
                "role": {
                    "name": "Customer Support Agent",
                    "systemPrompt": "You are a helpful customer support agent.",
                    "temperature": 0.7,
                },
                "skills": ["ticket", "knowledge", "communicate"],
                "default_tools": ["ticket_tool", "kb_tool", "email_tool"],
            },
        },
        "skill_templates": {
            key: template.model_dump() for key, template in SKILL_TEMPLATES.items()
        },
    }


async def validate_agent_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Validate agent configuration."""
    try:
        # Try to validate as enhanced config first
        if config.get("enableEnhancedSkills", True):
            validated = EnhancedAgentSyncRequest(**config)
            validation_type = "enhanced"
        else:
            validated = AgentSyncRequest(**config)
            validation_type = "legacy"

        return {
            "valid": True,
            "type": validation_type,
            "warnings": [],
            "skills_count": len(validated.skills),
            "tools_count": len(validated.tools),
        }

    except Exception as e:
        return {"valid": False, "error": str(e), "type": "unknown"}
