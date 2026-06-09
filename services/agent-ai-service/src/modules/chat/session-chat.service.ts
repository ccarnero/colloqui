import { Injectable, Logger } from "@nestjs/common";
import type { ModelMessage } from "ai";
import type { Agent } from "../agents/agent.model";
import type { ChatMessage, ChatResponse } from "./chat.dto";
import type { RuntimeState } from "./chat.dto";
import type { LlmExecutionResult } from "../llm/llm-executor.service";
import { LlmExecutorService } from "../llm/llm-executor.service";
import { MemoryClientService } from "../memory/memory-client.service";

const MAX_HISTORY_TURNS = 20;
const MAX_SESSION_AGE_MS = 60 * 60 * 1000;
const MAX_SESSIONS = 1000;

@Injectable()
export class SessionChatService {
  private readonly logger = new Logger(SessionChatService.name);

  private readonly sessions = new Map<
    string,
    {
      agentId: string;
      turns: ChatMessage[];
      lastAccessed: number;
    }
  >();

  constructor(
    private readonly llmExecutor: LlmExecutorService,
    private readonly memoryClient: MemoryClientService,
  ) {}

  async generateReply(
    tenantId: string,
    sessionId: string,
    agent: Agent,
    state: RuntimeState,
  ): Promise<ChatResponse> {
    const modelConfig = agent.modelConfig ?? {};
    const llm = (modelConfig.llm as Record<string, unknown>) ?? {};
    const provider = (modelConfig.provider as string) ?? (llm.provider as string) ?? "openai";
    const model = (modelConfig.model as string) ?? (llm.model as string) ?? "gpt-4o";
    const connectorId =
      (modelConfig.connectorId as string) ??
      (llm.connectorId as string) ??
      undefined;

    if (!modelConfig.provider || !modelConfig.model) {
      this.logger.warn(
        `Agent '${agent.id}' has no modelConfig.provider/model — using defaults: ${provider}/${model}`,
      );
    }

    const systemPrompt = this.buildSystemPrompt(agent, state);
    const messages = this.buildMessages(sessionId, state);

    this.logger.debug(
      `Session chat: session=${sessionId} agent=${agent.id} provider=${provider} model=${model} history=${messages.length - 1}`,
    );

    const hasTools = state.resolvedTools && Object.keys(state.resolvedTools).length > 0;

    const result: LlmExecutionResult = hasTools
      ? await this.llmExecutor.generateTextWithTools({
          tenantId,
          agentId: agent.id,
          executionId: `session-${sessionId}-${Date.now()}`,
          provider,
          model,
          systemPrompt,
          messages,
          tools: state.resolvedTools,
          maxSteps: 5,
          maxTokens: (modelConfig.maxTokens as number) ?? undefined,
          temperature: (modelConfig.temperature as number) ?? undefined,
          credentialId: modelConfig.credentialId as string | undefined,
          credentialMode: modelConfig.credentialMode as string | undefined,
          connectorId,
          knowledgeBaseIds: agent.knowledgeBaseIds,
        })
      : await this.llmExecutor.generateText({
          tenantId,
          agentId: agent.id,
          executionId: `session-${sessionId}-${Date.now()}`,
          provider,
          model,
          systemPrompt,
          messages,
          maxTokens: (modelConfig.maxTokens as number) ?? undefined,
          temperature: (modelConfig.temperature as number) ?? undefined,
          credentialId: modelConfig.credentialId as string | undefined,
          credentialMode: modelConfig.credentialMode as string | undefined,
          connectorId,
          knowledgeBaseIds: agent.knowledgeBaseIds,
        });

    this.appendTurn(sessionId, agent.id, "user", state.userMessage);
    this.appendTurn(sessionId, agent.id, "assistant", result.text);

    await this.persistTurnToMemory(tenantId, sessionId, agent.id, result.text);

    return {
      text: result.text,
      agentId: agent.id,
      usage: result.usage,
      costUsd: result.costUsd,
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      toolResults: result.toolResults,
      model: result.model,
      provider: result.provider,
    };
  }

  async generateStreamReply(
    tenantId: string,
    sessionId: string,
    agent: Agent,
    state: RuntimeState,
  ): Promise<ChatResponse> {
    const modelConfig = agent.modelConfig ?? {};
    const llm = (modelConfig.llm as Record<string, unknown>) ?? {};
    const provider = (modelConfig.provider as string) ?? (llm.provider as string) ?? "openai";
    const model = (modelConfig.model as string) ?? (llm.model as string) ?? "gpt-4o";
    const connectorId =
      (modelConfig.connectorId as string) ??
      (llm.connectorId as string) ??
      undefined;

    if (!modelConfig.provider || !modelConfig.model) {
      this.logger.warn(
        `Agent '${agent.id}' has no modelConfig.provider/model — using defaults: ${provider}/${model}`,
      );
    }

    const systemPrompt = this.buildSystemPrompt(agent, state);
    const messages = this.buildMessages(sessionId, state);

    this.logger.debug(
      `Session stream: session=${sessionId} agent=${agent.id} provider=${provider} model=${model}`,
    );

    const hasTools = state.resolvedTools && Object.keys(state.resolvedTools).length > 0;

    // When tools are available, use generateTextWithTools for multi-step tool execution
    // since streamText doesn't support maxSteps for tool loops.
    const result: LlmExecutionResult = hasTools
      ? await this.llmExecutor.generateTextWithTools({
          tenantId,
          agentId: agent.id,
          executionId: `stream-${sessionId}-${Date.now()}`,
          provider,
          model,
          systemPrompt,
          messages,
          tools: state.resolvedTools,
          maxSteps: 5,
          maxTokens: (modelConfig.maxTokens as number) ?? undefined,
          temperature: (modelConfig.temperature as number) ?? undefined,
          credentialId: modelConfig.credentialId as string | undefined,
          credentialMode: modelConfig.credentialMode as string | undefined,
          connectorId,
          knowledgeBaseIds: agent.knowledgeBaseIds,
        })
      : await this.llmExecutor.streamText({
          tenantId,
          agentId: agent.id,
          executionId: `stream-${sessionId}-${Date.now()}`,
          provider,
          model,
          systemPrompt,
          messages,
          maxTokens: (modelConfig.maxTokens as number) ?? undefined,
          temperature: (modelConfig.temperature as number) ?? undefined,
          credentialId: modelConfig.credentialId as string | undefined,
          credentialMode: modelConfig.credentialMode as string | undefined,
          connectorId,
          knowledgeBaseIds: agent.knowledgeBaseIds,
        });

    this.appendTurn(sessionId, agent.id, "user", state.userMessage);
    this.appendTurn(sessionId, agent.id, "assistant", result.text);

    return {
      text: result.text,
      agentId: agent.id,
      usage: result.usage,
      costUsd: result.costUsd,
      toolCalls: result.toolCalls.length > 0 ? result.toolCalls : undefined,
      toolResults: result.toolResults,
      model: result.model,
      provider: result.provider,
    };
  }

  getSessionHistory(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return [...session.turns];
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private buildMessages(
    sessionId: string,
    state: RuntimeState,
  ): ModelMessage[] {
    const messages: ModelMessage[] = [];
    const session = this.sessions.get(sessionId);
    const history = session
      ? session.turns.slice(-MAX_HISTORY_TURNS)
      : [];

    for (const turn of history) {
      messages.push({
        role: turn.role,
        content: turn.content,
      });
    }

    for (const prev of state.conversationHistory) {
      messages.push({
        role: prev.role,
        content: prev.content,
      });
    }

    messages.push({ role: "user", content: state.userMessage });

    return messages;
  }

  private appendTurn(
    sessionId: string,
    agentId: string,
    role: "user" | "assistant",
    content: string,
  ): void {
    this.evictExpiredSessions();

    let session = this.sessions.get(sessionId);
    if (!session) {
      session = { agentId, turns: [], lastAccessed: Date.now() };
      this.sessions.set(sessionId, session);
    }
    session.turns.push({
      role,
      content,
      timestamp: new Date().toISOString(),
    });
    session.lastAccessed = Date.now();
  }

  private evictExpiredSessions(): void {
    if (this.sessions.size <= MAX_SESSIONS) {
      const now = Date.now();
      let evicted = 0;
      for (const [id, session] of this.sessions) {
        if (now - session.lastAccessed > MAX_SESSION_AGE_MS) {
          this.sessions.delete(id);
          evicted++;
        }
      }
      if (evicted > 0) {
        this.logger.debug(`Evicted ${evicted} expired sessions (${this.sessions.size} remaining)`);
      }
    }

    if (this.sessions.size > MAX_SESSIONS) {
      const entries = [...this.sessions.entries()].sort(
        (a, b) => a[1].lastAccessed - b[1].lastAccessed,
      );
      const excess = this.sessions.size - MAX_SESSIONS;
      for (let i = 0; i < excess; i++) {
        this.sessions.delete(entries[i][0]);
      }
      this.logger.warn(`Evicted ${excess} LRU sessions (exceeded MAX_SESSIONS=${MAX_SESSIONS})`);
    }
  }

  private buildSystemPrompt(
    agent: Agent,
    state: RuntimeState,
  ): string {
    const parts: string[] = [state.renderedSystemPrompt ?? agent.systemPrompt];

    if (agent.rules && agent.rules.length > 0) {
      const ruleTexts = agent.rules
        .filter(
          (r): r is Record<string, unknown> =>
            typeof r === "object" && r !== null,
        )
        .map((r) => {
          const text = r.text ?? r.content ?? r.rule ?? "";
          return typeof text === "string" ? text : JSON.stringify(text);
        })
        .filter((t) => t.length > 0);

      if (ruleTexts.length > 0) {
        parts.push(
          `\nRules:\n${ruleTexts.map((t) => `- ${t}`).join("\n")}`,
        );
      }
    }

    if (state.memoryContext) {
      parts.push(`\n\n${state.memoryContext}`);
    }

    return parts.join("\n");
  }

  private async persistTurnToMemory(
    tenantId: string,
    sessionId: string,
    agentId: string,
    assistantText: string,
  ): Promise<void> {
    try {
      await this.memoryClient.create(tenantId, {
        scope: "SESSION",
        kind: "FACT",
        title: `Session ${sessionId} turn`,
        content: assistantText.slice(0, 2000),
        sessionId,
        metadata: { agentId, sessionId },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist turn to memory: session=${sessionId} error=${error}`,
      );
    }
  }
}
