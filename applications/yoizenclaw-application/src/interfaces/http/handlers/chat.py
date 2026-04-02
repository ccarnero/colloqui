"""Chat response handlers for YoizenClaw API."""

from typing import Any, Literal

from fastapi import HTTPException
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
    """Payload for interactive webchat responses."""
    agent: AgentSyncRequest | None = None
    agentId: str | None = None
    message: str
    customerName: str = "Customer"
    conversationId: str = ""
    channel: str = "webchat"
    context: list[ChatContextMessage] = []


class ChatResponse(BaseModel):
    """Response model for interactive webchat endpoint."""
    success: bool
    reply: str
    tool_calls: list[dict[str, Any]] = []


def _build_chat_prompt(request: ChatRequest) -> str:
    """Build a compact prompt for live chat interactions."""
    context_lines: list[str] = []
    for message in request.context:
        speaker = "Customer" if message.sender == "customer" else "Assistant"
        context_lines.append(f"{speaker}: {message.content}")

    context_block = (
        "\n".join(context_lines) if context_lines else "No previous messages."
    )
    try:
        return chat_prompt_loader.render(
            "user/webchat_message",
            customerName=request.customerName,
            channel=request.channel,
            conversationId=request.conversationId or "n/a",
            context=context_block,
            message=request.message,
        )
    except PromptLoadError:
        return (
            f"Customer name: {request.customerName}\n"
            f"Channel: {request.channel}\n"
            f"Conversation id: {request.conversationId or 'n/a'}\n\n"
            f"Conversation so far:\n{context_block}\n\n"
            f"Latest customer message:\n{request.message}\n\n"
            "Reply as the assistant."
        )


def _build_tool_context(request: ChatRequest) -> dict[str, object]:
    conversation_history = "\n".join(
        [f"{message.sender}: {message.content}" for message in request.context]
    )
    return {
        "input": {
            "message": request.message,
            "customer_name": request.customerName,
        },
        "context": {
            "channel": request.channel,
            "conversation_id": request.conversationId,
            "conversation_history": conversation_history,
            "customer_name": request.customerName,
        },
        "memory": {},
        "channel": request.channel,
        "conversation_history": conversation_history,
        "conversation_id": request.conversationId,
        "customer_message": request.message,
        "customer_name": request.customerName,
        "message": request.message,
    }


def _get_field(mapping: Any, field_name: str) -> Any:
    if isinstance(mapping, dict):
        return mapping.get(field_name)
    if isinstance(mapping, BaseModel):
        return getattr(mapping, field_name, None)
    return getattr(mapping, field_name, None)


def _has_enabled_skills(agent: RuntimeAgent) -> bool:
    skills = [
        skill
        for skill in getattr(agent, "skills", [])
        if _get_field(skill, "enabled") is not False
    ]
    return bool(skills)


async def _get_chat_agent(request: ChatRequest) -> RuntimeAgent:
    """Resolve a runtime agent for the current webchat request."""
    if request.agent is None:
        manager = get_agent_manager()
        if request.agentId:
            return await manager.get_agent(request.agentId)

        return await manager.get_agent_for_channel(request.channel)

    try:
        config = RuntimeConfigStore.get_optional()
        if config is None:
            raise HTTPException(
                status_code=503,
                detail=(
                    "Agent personality not configured. "
                    "Backend must sync agent configuration to the runtime."
                ),
            )

        base_prompt = config.agent.system_prompt
        system_prompt = build_agent_system_prompt(
            base_prompt,
            request.agent.model_dump(by_alias=False, exclude_none=True),
        )
        return RuntimeAgent(
            system_prompt=system_prompt,
            llm_config=request.agent.llm.model_dump(
                by_alias=False,
                exclude_none=True,
            ),
            tools=request.agent.tools,
            skills=request.agent.skills,
            prompt_loader=chat_prompt_loader,
            tool_registry=get_registry(),
            agent_metadata={
                "id": request.agentId or "",
                "name": request.agent.name,
                "description": request.agent.description,
            },
        )
    except RuntimeNotConfiguredError:
        raise HTTPException(
            status_code=503,
            detail=(
                "Agent personality not configured. "
                "Backend must sync agent configuration to the runtime."
            ),
        )
    except PromptLoadError as error:
        raise HTTPException(status_code=500, detail=str(error))


async def generate_chat_reply(request: ChatRequest) -> ChatResponse:
    """Generate a live response for a chat request."""
    try:
        agent = await _get_chat_agent(request)
        prompt = _build_chat_prompt(request)
        tool_calls: list[dict[str, Any]] = []
        if _has_enabled_skills(agent):
            result = await agent.run_with_skill(
                prompt,
                context=_build_tool_context(request),
            )
            reply = str(result.get("response", "")).strip()
            raw_tool_calls = result.get("tool_calls", [])
            if isinstance(raw_tool_calls, list):
                tool_calls = [
                    tool_call
                    for tool_call in raw_tool_calls
                    if isinstance(tool_call, dict)
                ]
            if not reply:
                reply = await agent.run(prompt, context=_build_tool_context(request))
        else:
            reply = await agent.run(prompt, context=_build_tool_context(request))
        return ChatResponse(
            success=True,
            reply=reply,
            tool_calls=tool_calls,
        )
    except PromptLoadError as error:
        raise HTTPException(status_code=500, detail=str(error))
    except RuntimeNotConfiguredError as error:
        raise HTTPException(
            status_code=503,
            detail=f"Runtime not configured: {error}",
        )
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "CHAT_RESPONSE_ERROR",
                "message": str(error),
            },
        )
