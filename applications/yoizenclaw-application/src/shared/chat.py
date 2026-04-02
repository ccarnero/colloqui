"""Chat response functionality for YoizenClaw.

Provides chat handling that can be used by both NATS and HTTP interfaces.
"""

from typing import Any, Literal

from pydantic import BaseModel

from src.application.agents.agent import Agent as RuntimeAgent
from src.application.agents.agent_manager import get_agent_manager
from src.shared.config.agent_config import (
    AgentSyncRequest,
    build_agent_system_prompt,
)
from src.shared.config.config_loader_settings import get_runtime_prompts_dir
from src.shared.config.prompts import PromptLoadError, PromptLoader
from src.shared.config.runtime_config_store import RuntimeConfigStore
from src.shared.errors.base import RuntimeNotConfiguredError
from src.tools.registry import get_registry

chat_prompt_loader = PromptLoader(str(get_runtime_prompts_dir()))


class ChatContextMessage(BaseModel):
    """Single chat message item received from the backend."""
    sender: Literal["customer", "agent", "bot"]
    content: str
    createdAt: str | None = None


class ChatRequest(BaseModel):
    """Request model for chat response endpoint."""
    agentId: str | None = None
    message: str
    customerName: str | None = None
    conversationId: str | None = None
    channel: str | None = None
    context: list[ChatContextMessage] | None = None
    metadata: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    """Response model for chat endpoint."""
    response: str
    reply: str = ""  # Alias for compatibility
    conversationId: str | None = None
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
    
    runtime_config = RuntimeConfigStore.get_optional()
    if runtime_config is None:
        raise RuntimeNotConfiguredError(
            "Runtime not configured. Wait for backend configuration."
        )
    
    return RuntimeAgent(
        system_prompt=runtime_config.agent.system_prompt,
    )


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
    
    # Build context from conversation history if provided
    context_str = ""
    if request.context:
        for msg in request.context:
            if msg.sender == "customer":
                context_str += f"User: {msg.content}\n"
            else:
                context_str += f"Assistant: {msg.content}\n"
    
    full_prompt = context_str + f"User: {request.message}\nAssistant:"
    
    # Check if agent has skills
    if hasattr(agent, 'skills') and agent.skills:
        # Use skill-based execution
        result = await agent.run_with_skill(
            request.message,
            context={
                "conversation_id": request.conversationId,
                "customer_message": request.message,
                "customer_name": request.customerName,
                "channel": request.channel,
                "conversation_history": context_str.strip(),
                "input": {
                    "customer_name": request.customerName,
                },
                "context": {
                    "channel": request.channel,
                },
            } if request.customerName or request.channel else None
        )
        return ChatResponse(
            response=result.get("response", ""),
            reply=result.get("response", ""),
            conversationId=request.conversationId,
            tool_calls=result.get("tool_calls"),
            metadata={"model": agent.llm_client.model, "provider": agent.llm_client.provider},
        )
    else:
        # Use plain run
        response_text = await agent.run(request.message)
        return ChatResponse(
            response=response_text,
            reply=response_text,
            conversationId=request.conversationId,
            metadata={"model": agent.llm_client.model, "provider": agent.llm_client.provider},
        )
