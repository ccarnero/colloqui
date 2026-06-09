import { Injectable, Logger } from "@nestjs/common";
import type { Agent } from "../agents/agent.model";
import type { ChatContextMessage, RuntimeState } from "./chat.dto";
import { MemoryContextBuilderService } from "../memory/memory-context-builder.service";

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private readonly memoryContextBuilder: MemoryContextBuilderService,
  ) {}

  async buildRuntimeState(
    tenantId: string,
    agent: Agent,
    message: string,
    context?: ChatContextMessage[],
    extra?: Record<string, unknown>,
  ): Promise<RuntimeState> {
    const memoryContext = await this.memoryContextBuilder.buildContext(
      tenantId,
      agent.id,
      message,
    );

    const memoryPrompt =
      this.memoryContextBuilder.formatForPrompt(memoryContext);

    const conversationHistory = this.buildConversationHistory(context);

    const runtimeContext = this.buildRuntimeContext(
      tenantId,
      agent,
      message,
      context,
      extra,
    );

    return {
      systemPrompt: agent.systemPrompt,
      rules: agent.rules,
      memoryContext: memoryPrompt,
      conversationHistory,
      availableTools: agent.tools,
      availableSkills: agent.skills,
      userMessage: message,
      runtimeContext,
    };
  }

  private buildConversationHistory(
    context?: ChatContextMessage[],
  ): Array<{ role: "user" | "assistant"; content: string; timestamp: string }> {
    if (!context || context.length === 0) return [];

    return context.map((msg) => ({
      role: (msg.sender === "customer" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: msg.content,
      timestamp: msg.createdAt ?? new Date().toISOString(),
    }));
  }

  private buildRuntimeContext(
    tenantId: string,
    agent: Agent,
    message: string,
    context?: ChatContextMessage[],
    extra?: Record<string, unknown>,
  ): Record<string, unknown> {
    const contextStr = (context ?? [])
      .map((msg) =>
        msg.sender === "customer"
          ? `User: ${msg.content}`
          : `Assistant: ${msg.content}`,
      )
      .join("\n");

    return {
      tenantId,
      agentId: agent.id,
      customerMessage: message,
      conversationHistory: contextStr.trim(),
      input: {
        message,
        user_prompt: message,
      },
      context: {},
      memory: {},
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
      },
      ...extra,
    };
  }
}
