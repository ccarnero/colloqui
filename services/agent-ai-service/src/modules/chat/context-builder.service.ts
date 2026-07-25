import { Injectable, Logger } from "@nestjs/common";
import type { VariableResolutionContext } from "@yoizen/shared";
import type { Agent } from "../agents/agent.model";
import { MemoryContextBuilderService } from "../memory/memory-context-builder.service";
import type { ChatContextMessage, RuntimeState } from "./chat.dto";
import { SystemVariablesProvider } from "./system-variables.provider";

@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);

  constructor(
    private readonly memoryContextBuilder: MemoryContextBuilderService,
    private readonly systemVariablesProvider: SystemVariablesProvider
  ) {}

  async buildRuntimeState(
    tenantId: string,
    agent: Agent,
    message: string,
    context?: ChatContextMessage[],
    extra?: Record<string, unknown>
  ): Promise<RuntimeState> {
    const memoryContext = await this.memoryContextBuilder.buildContext(
      tenantId,
      agent.id,
      message
    );

    const memoryPrompt =
      this.memoryContextBuilder.formatForPrompt(memoryContext);

    const conversationHistory = this.buildConversationHistory(context);

    const resolvedExtra = await this.withResolvedVariables(tenantId, extra);

    const runtimeContext = this.buildRuntimeContext(
      tenantId,
      agent,
      message,
      context,
      resolvedExtra
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

  /**
   * Server-side fallback for `variables.system`: when the caller (chat
   * handler / execution handler) supplies no `variables`, or supplies
   * `variables` with an empty/missing `system` namespace, this loads the
   * tenant's system variables itself so `{{variables.system.<name>}}`
   * placeholders still resolve. When the caller DID provide a non-empty
   * `system` namespace, it wins untouched — no fallback query is made.
   *
   * This is the single spot both `ChatService.generateReply` (chat.handler
   * + buffered execution.handler path) and `ChatService.generateStream`
   * (streaming execution.handler path) traverse via `buildRuntimeState`,
   * so the fallback applies uniformly regardless of caller.
   */
  private async withResolvedVariables(
    tenantId: string,
    extra?: Record<string, unknown>
  ): Promise<Record<string, unknown> | undefined> {
    const provided = extra?.variables as VariableResolutionContext | undefined;
    const hasCallerSystem =
      !!provided?.system && Object.keys(provided.system).length > 0;

    if (hasCallerSystem) {
      return extra;
    }

    const system = await this.loadSystemVariablesFallback(tenantId);
    const variables: VariableResolutionContext = {
      system,
      workflow: provided?.workflow ?? {},
      previous: provided?.previous ?? {},
      node: provided?.node ?? {},
      request: provided?.request ?? {},
    };

    return { ...extra, variables };
  }

  /**
   * Degrades to an empty map on query failure (unreachable Postgres,
   * missing table, etc.) rather than failing the whole execution — mirrors
   * `workflow-service`'s `WorkflowsService.startExecution` call-site
   * handling of `SystemVariablesProvider.loadForTenant`.
   */
  private async loadSystemVariablesFallback(
    tenantId: string
  ): Promise<Record<string, unknown>> {
    try {
      return await this.systemVariablesProvider.loadForTenant(tenantId);
    } catch (error) {
      this.logger.warn(
        `Failed to load system variables fallback for tenant '${tenantId}', continuing with empty system vars: ${error}`
      );
      return {};
    }
  }

  private buildConversationHistory(
    context?: ChatContextMessage[]
  ): Array<{ role: "user" | "assistant"; content: string; timestamp: string }> {
    if (!context || context.length === 0) {
      return [];
    }

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
    extra?: Record<string, unknown>
  ): Record<string, unknown> {
    const contextStr = (context ?? [])
      .map((msg) =>
        msg.sender === "customer"
          ? `User: ${msg.content}`
          : `Assistant: ${msg.content}`
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
