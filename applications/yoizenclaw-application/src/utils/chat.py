"""Chat response functionality for YoizenClaw.

Provides chat handling that can be used by both NATS and HTTP interfaces.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator

from src.app.agents.agent import Agent as RuntimeAgent
from src.app.agents.agent_manager import get_agent_manager
from src.utils.config.agent_config import (
    AgentSyncRequest,
    build_agent_system_prompt,
)
from src.utils.config.config_loader_settings import get_runtime_prompts_dir
from src.utils.config.prompts import PromptLoadError, PromptLoader
from src.utils.config.runtime_config_store import RuntimeConfigStore
from src.utils.errors.base import RuntimeNotConfiguredError
from src.app.tools.registry import get_registry

chat_prompt_loader = PromptLoader(str(get_runtime_prompts_dir()))


class ChatContextMessage(BaseModel):
    """Single chat message item received from the backend."""

    sender: Literal["customer", "agent", "bot"]
    content: str
    createdAt: str | None = None


class ChatRequest(BaseModel):
    """Request model for chat response endpoint."""

    model_config = ConfigDict(populate_by_name=True)

    agentId: str | None = None
    message: str
    customerName: str | None = None
    conversationId: str | None = None
    chatId: str | None = None
    userId: str | None = None
    channel: str | None = None
    context: list[ChatContextMessage] | None = None
    metadata: dict[str, Any] | None = None

    @model_validator(mode="before")
    @classmethod
    def _normalize_aliases(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        alias_pairs = {
            "agent_id": "agentId",
            "conversation_id": "conversationId",
            "chat_id": "chatId",
            "user_id": "userId",
            "customer_name": "customerName",
        }
        for source_key, target_key in alias_pairs.items():
            if source_key in normalized and target_key not in normalized:
                normalized[target_key] = normalized.pop(source_key)
        return normalized


class ChatResponse(BaseModel):
    """Response model for chat endpoint."""

    response: str
    reply: str = ""  # Alias for compatibility
    conversationId: str | None = None
    userId: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    metadata: dict[str, Any] | None = None

    def model_post_init(self, __context: Any) -> None:
        """Ensure reply field matches response."""
        if not self.reply and self.response:
            self.reply = self.response


async def _get_chat_agent(request: ChatRequest) -> RuntimeAgent:
    """Get or create an agent for chat handling.

    Args:
        request: Chat request with agent configuration.

    Returns:
        Configured RuntimeAgent instance.

    Raises:
        RuntimeNotConfiguredError: If runtime is not configured.
    """
    agent_manager = get_agent_manager()

    if not agent_manager.is_configured():
        raise RuntimeNotConfiguredError(
            "Agent manager not configured. Wait for backend configuration."
        )

    # Use agentId from request to resolve the specific published agent
    agent_id = request.agentId
    if not agent_id:
        # Fallback to default if no agentId provided
        runtime_config = RuntimeConfigStore.get_optional()
        if runtime_config is None:
            raise RuntimeNotConfiguredError(
                "Runtime not configured and no agentId provided."
            )
        return RuntimeAgent(
            system_prompt=runtime_config.agent.system_prompt,
        )

    # Resolve the specific agent by ID
    try:
        agent = await agent_manager.get_agent(agent_id)
        return agent
    except Exception as e:
        raise RuntimeNotConfiguredError(f"Failed to resolve agent '{agent_id}': {e}")


async def generate_chat_reply(request: ChatRequest) -> ChatResponse:
    """Generate a chat response using the configured agent.

    Args:
        request: Chat request with message and context.

    Returns:
        Chat response with generated text.

    Raises:
        RuntimeNotConfiguredError: If runtime is not configured.
    """
    agent = await _get_chat_agent(request)
    configured_tools = getattr(getattr(agent, "_tool_executor", None), "tools", [])
    tenant_memory_context = await get_registry().build_tenant_memory_context(
        configured_tools,
    )

    # Build context from conversation history if provided
    context_str = ""
    if request.context:
        for msg in request.context:
            if msg.sender == "customer":
                context_str += f"User: {msg.content}\n"
            else:
                context_str += f"Assistant: {msg.content}\n"

    full_prompt = context_str + f"User: {request.message}\nAssistant:"
    runtime_context = {
        "conversation_id": request.conversationId,
        "chat_id": request.chatId,
        "user_id": request.userId,
        "agent_id": request.agentId,
        "customer_message": request.message,
        "customer_name": request.customerName,
        "channel": request.channel,
        "conversation_history": context_str.strip(),
        "input": {
            "customer_name": request.customerName,
            "user_id": request.userId,
            "chat_id": request.chatId,
        },
        "context": {
            "channel": request.channel,
            "chat_id": request.chatId,
            "user_id": request.userId,
        },
        "memory": tenant_memory_context,
        "tenant_memory_summary": tenant_memory_context.get("tenant", {}).get(
            "summary",
            "",
        ),
        "tenant_memories": tenant_memory_context.get("tenant", {}).get("items", []),
    }

    # Check if agent has skills and use enhanced execution if available
    if hasattr(agent, "skills") and agent.skills:
        # Check if it's an enhanced agent
        if (
            hasattr(agent, "run_with_enhanced_skill")
            and agent.agent_metadata
            and agent.agent_metadata.get("enhanced")
        ):
            # Determine routing mode
            routing_mode = (agent.agent_metadata or {}).get(
                "skill_routing_mode", "llm_driven"
            )

            if routing_mode == "llm_driven" and hasattr(agent, "run_llm_driven"):
                # LLM-driven: the LLM decides which skill to activate
                result = await agent.run_llm_driven(
                    request.message,
                    context=runtime_context,
                )
            else:
                # Router mode: SkillRouter decides before the LLM
                result = await agent.run_with_enhanced_skill(
                    request.message,
                    context=runtime_context,
                )
        else:
            # Use legacy skill-based execution
            result = await agent.run_with_skill(
                request.message,
                context=runtime_context,
            )

        return ChatResponse(
            response=result.get("response", ""),
            reply=result.get("response", ""),
            conversationId=request.conversationId,
            userId=request.userId,
            tool_calls=result.get("tool_calls"),
            metadata={
                "model": agent.llm_client.model,
                "provider": agent.llm_client.provider,
            },
        )
    else:
        # Use plain run
        response_text = await agent.run(request.message, context=runtime_context)
        return ChatResponse(
            response=response_text,
            reply=response_text,
            conversationId=request.conversationId,
            userId=request.userId,
            metadata={
                "model": agent.llm_client.model,
                "provider": agent.llm_client.provider,
            },
        )
