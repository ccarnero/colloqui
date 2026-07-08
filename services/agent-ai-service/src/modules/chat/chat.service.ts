import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Agent } from "../agents/agent.model";
// biome-ignore-start lint/style/useImportType: constructor-injected by NestJS DI (no explicit @Inject token) — must be value imports so `design:paramtypes` metadata resolves the real class at runtime, not `type`.
import { AgentManagerService } from "../agents/agent-manager.service";
import {
  LlmExecutorService,
  type StreamTextResult,
} from "../llm/llm-executor.service";
import { parsePromptReferences } from "../prompt-references/prompt-references.parser";
import type { SkillDefinition } from "../skills/skill-definition";
import { SkillExecutorService } from "../skills/skill-executor.service";
import { catalogSkillToSkillDefinition } from "../skills/skill-mapper";
import { SkillRouterService } from "../skills/skill-router.service";
import { TemplateRendererService } from "../template-renderer/template-renderer.service";
import { McpConnectionService } from "../tools/mcp-connection.service";
import { ToolBridgeService } from "../tools/tool-bridge.service";
import type { ToolExecutionContext } from "../tools/tool-definition";
import type { ChatRequest, ChatResponse, RuntimeState } from "./chat.dto";
import { ContextBuilderService } from "./context-builder.service";
import { SessionChatService } from "./session-chat.service";
// biome-ignore-end lint/style/useImportType

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly agentManager: AgentManagerService,
    private readonly contextBuilder: ContextBuilderService,
    private readonly sessionChat: SessionChatService,
    private readonly llmExecutor: LlmExecutorService,
    private readonly templateRenderer: TemplateRendererService,
    private readonly skillRouter: SkillRouterService,
    private readonly skillExecutor: SkillExecutorService,
    private readonly toolBridge: ToolBridgeService,
    private readonly mcpConnection: McpConnectionService
  ) {}

  async generateReply(
    tenantId: string,
    request: ChatRequest,
    options?: { abortSignal?: AbortSignal }
  ): Promise<ChatResponse> {
    this.logger.debug(
      `generateReply: tenant=${tenantId} agent=${request.agentId} session=${request.sessionId ?? "none"}`
    );

    const agent = await this.agentManager.getAgent(tenantId, request.agentId);
    if (!agent) {
      throw new NotFoundException(
        `Agent '${request.agentId}' not found for tenant '${tenantId}'`
      );
    }

    const extra: Record<string, unknown> = {};
    if (request.conversationId) {
      extra.conversationId = request.conversationId;
    }
    if (request.chatId) {
      extra.chatId = request.chatId;
    }
    if (request.userId) {
      extra.userId = request.userId;
    }
    if (request.customerName) {
      extra.customerName = request.customerName;
    }
    if (request.channel) {
      extra.channel = request.channel;
    }
    if (request.variables) {
      extra.variables = request.variables;
    }

    let state = await this.contextBuilder.buildRuntimeState(
      tenantId,
      agent,
      request.message,
      request.context,
      extra
    );

    state = await this.preparePrompt(agent, state);

    // Always use session-based chat for proper conversation context and prompt caching
    const sessionId = request.sessionId ?? `chat-${agent.id}-${Date.now()}`;
    return this.sessionChat.generateReply(
      tenantId,
      sessionId,
      agent,
      state,
      options?.abortSignal
    );
  }

  async generateStreamReply(
    tenantId: string,
    request: ChatRequest
  ): Promise<ChatResponse> {
    const sessionId = request.sessionId ?? `stream-${Date.now()}`;

    this.logger.debug(
      `generateStreamReply: tenant=${tenantId} agent=${request.agentId} session=${sessionId}`
    );

    const agent = await this.agentManager.getAgent(tenantId, request.agentId);
    if (!agent) {
      throw new NotFoundException(
        `Agent '${request.agentId}' not found for tenant '${tenantId}'`
      );
    }

    let state = await this.contextBuilder.buildRuntimeState(
      tenantId,
      agent,
      request.message,
      request.context
    );

    state = await this.preparePrompt(agent, state);

    return this.sessionChat.generateStreamReply(
      tenantId,
      sessionId,
      agent,
      state
    );
  }

  async generateStream(
    tenantId: string,
    request: ChatRequest,
    options?: { executionId?: string; abortSignal?: AbortSignal }
  ): Promise<StreamTextResult & { agentId: string }> {
    this.logger.debug(
      `generateStream: tenant=${tenantId} agent=${request.agentId}`
    );

    const agent = await this.agentManager.getAgent(tenantId, request.agentId);
    if (!agent) {
      throw new NotFoundException(
        `Agent '${request.agentId}' not found for tenant '${tenantId}'`
      );
    }

    let state = await this.contextBuilder.buildRuntimeState(
      tenantId,
      agent,
      request.message,
      request.context
    );

    state = await this.preparePrompt(agent, state);

    const modelConfig = agent.modelConfig ?? {};
    const llm = (modelConfig.llm as Record<string, unknown>) ?? {};
    const provider =
      (modelConfig.provider as string) ?? (llm.provider as string) ?? "openai";
    const model =
      (modelConfig.model as string) ?? (llm.model as string) ?? "gpt-4o";
    const connectorId =
      (modelConfig.connectorId as string) ??
      (llm.connectorId as string) ??
      undefined;

    if (!modelConfig.provider || !modelConfig.model) {
      this.logger.warn(
        `Agent '${agent.id}' has no modelConfig.provider/model — using defaults: ${provider}/${model}`
      );
    }

    const systemPrompt = state.renderedSystemPrompt ?? agent.systemPrompt;

    // TODO: Wire tools into streaming when streamText supports maxSteps
    const messages = [
      { role: "system" as const, content: systemPrompt },
      ...(state.conversationHistory ?? []).map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: state.userMessage },
    ];

    const streamResult = await this.llmExecutor.streamTextRaw({
      tenantId,
      agentId: agent.id,
      executionId: options?.executionId ?? `stream-${Date.now()}`,
      provider,
      model,
      messages,
      maxTokens: (modelConfig.maxTokens as number) ?? undefined,
      temperature: (modelConfig.temperature as number) ?? undefined,
      credentialId: modelConfig.credentialId as string | undefined,
      credentialMode: modelConfig.credentialMode as string | undefined,
      connectorId,
      knowledgeBaseIds: agent.knowledgeBaseIds,
      abortSignal: options?.abortSignal,
    });

    return {
      ...streamResult,
      agentId: agent.id,
    };
  }

  private async preparePrompt(
    agent: Agent,
    state: RuntimeState
  ): Promise<RuntimeState> {
    const warnings: string[] = [];

    // 1. Render template placeholders against runtime context
    const renderedPrompt = this.templateRenderer.renderPromptText(
      agent.systemPrompt,
      state.runtimeContext as Record<string, unknown>,
      warnings
    );

    // 2. Parse @skill: and @tool: references from prompt
    const { cleanedText, skillReferences } =
      parsePromptReferences(renderedPrompt);

    // 3. Resolve skill
    let resolvedSkill: SkillDefinition | null = null;

    if (agent.skills && agent.skills.length > 0) {
      const typedSkills = agent.skills.map((s: unknown) => {
        const cat = s as Record<string, unknown>;
        if (cat.system_prompt !== undefined) {
          return catalogSkillToSkillDefinition(cat as any);
        }
        return s as SkillDefinition;
      });
      this.skillRouter.setSkills(typedSkills);

      const skillContext = {
        userMessage: state.userMessage,
        explicitSkillName: skillReferences[0],
        availableSkills: typedSkills,
        warnings,
      };

      resolvedSkill = this.skillRouter.findSkill(skillContext);
    }

    // 4. If skill resolved, execute inline to get instructions
    let finalPrompt = cleanedText;
    let skillName: string | undefined;
    let skillInstructions: string | undefined;

    if (resolvedSkill) {
      skillName = resolvedSkill.name;
      const modelConfig = agent.modelConfig ?? {};

      const skillResult = await this.skillExecutor.executeInline({
        skill: resolvedSkill,
        userMessage: state.userMessage,
        tenantId: state.runtimeContext.tenantId as string,
        agentId: agent.id,
        executionId: `skill-${Date.now()}`,
        provider: (modelConfig.provider as string) ?? "openai",
        model: (modelConfig.model as string) ?? "gpt-4o",
      });

      if (skillResult.processedInstructions) {
        skillInstructions = skillResult.processedInstructions;
        finalPrompt = `${cleanedText}\n\n## Active Skill: ${resolvedSkill.name}\n${skillResult.processedInstructions}`;
      }
    }

    // 5. Append skill summaries if skills are available but none resolved
    if (!resolvedSkill && agent.skills && agent.skills.length > 0) {
      const summaries = this.skillRouter.getSkillSummariesForLlm();
      if (summaries && summaries !== "No skills available.") {
        finalPrompt = `${finalPrompt}\n\n## Available Skills\n${summaries}`;
      }
    }

    // Log warnings
    for (const w of warnings) {
      this.logger.warn(`Prompt preparation: ${w}`);
    }

    // 6. Ensure MCP servers are connected for this tenant
    const tenantId = state.runtimeContext.tenantId as string;
    await this.mcpConnection.connectForTenant(tenantId);

    // 7. Resolve agent tools to AI SDK format
    let resolvedTools: Record<string, any> | undefined;
    const hasAgentTools = (agent.tools?.length ?? 0) > 0;
    // enabledMcpServers: null/undefined = all connected MCP servers; [] = explicitly none
    const mcpEnabled =
      agent.enabledMcpServers == null || agent.enabledMcpServers.length > 0;

    if (hasAgentTools || mcpEnabled) {
      try {
        const toolState: ToolExecutionContext = {
          tenantId,
          agentId: agent.id,
          executionId: `chat-${Date.now()}`,
          sessionId: state.runtimeContext.sessionId as string | undefined,
          userId: state.runtimeContext.userId as string | undefined,
          conversationId: state.runtimeContext.conversationId as
            | string
            | undefined,
        };
        resolvedTools = await this.toolBridge.toAiSdkToolsForAgent(
          agent.tools ?? [],
          toolState,
          agent.enabledTools,
          agent.enabledMcpServers,
          agent.toolDescriptionOverrides,
          agent.enabledMcpTools
        );
      } catch (error) {
        this.logger.warn(
          `Failed to resolve tools for agent '${agent.id}': ${error}. Proceeding without tools.`
        );
      }
    }

    return {
      ...state,
      renderedSystemPrompt: finalPrompt,
      skillInstructions,
      activeSkillName: skillName,
      resolvedTools,
    };
  }
}
