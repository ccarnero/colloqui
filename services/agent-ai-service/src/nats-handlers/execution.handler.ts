import { Inject, Injectable } from "@nestjs/common";
import type { JetStreamClient } from "nats";
import { PinoLoggerService } from "@yoizen/observability";
import { ChatService } from "../modules/chat/chat.service";
import type { ChatRequest } from "../modules/chat/chat.dto";
import { JETSTREAM } from "../providers/nats.provider";
import {
  buildEventEnvelope,
  deriveEnvelope,
  type EventEnvelope,
  type VariableResolutionContext,
} from "@yoizen/shared";

@Injectable()
export class ExecutionHandler {
  private readonly logger = new PinoLoggerService(ExecutionHandler.name);

  constructor(
    private readonly chatService: ChatService,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
  ) {}

  async handle(
    tenantId: string,
    payload: Record<string, unknown>,
    envelope?: EventEnvelope,
  ): Promise<void> {
    // Gateway wraps execution data in payload.input, support both formats
    const input = (payload.input ?? payload) as Record<string, unknown>;
    const executionId = (input.executionId ?? payload.executionId) as string | undefined;
    const agentId = (input.agentId ?? payload.agentId) as string | undefined;
    const message = (input.message ?? payload.message) as string | undefined;

    if (!agentId || !message) {
      this.logger.warn(
        `[execution] Missing agentId or message for tenant '${tenantId}' execution='${executionId ?? "unknown"}'`,
      );
      return;
    }

    this.logger.log(
      `[execution] Starting: tenant='${tenantId}' execution='${executionId ?? "n/a"}' agent='${agentId}'`,
    );

    await this.publishStatus(tenantId, "execution_started", {
      executionId,
      agentId,
      tenantId,
      state: "started",
    }, envelope);

    try {
      const request: ChatRequest = {
        agentId,
        message,
        conversationId: (input.conversationId ?? payload.conversationId) as string | undefined,
        sessionId: (input.sessionId ?? payload.sessionId) as string | undefined,
        chatId: (input.chatId ?? payload.chatId) as string | undefined,
        userId: (input.userId ?? payload.userId) as string | undefined,
        customerName: (input.customerName ?? payload.customerName) as string | undefined,
        channel: (input.channel ?? payload.channel) as string | undefined,
        context: (input.context ?? payload.context) as ChatRequest["context"],
        metadata: (input.metadata ?? payload.metadata) as Record<string, unknown> | undefined,
        variables: (input.variables ?? payload.variables) as VariableResolutionContext | undefined,
      };

      const result = await this.chatService.generateReply(tenantId, request);

      await this.publishStatus(tenantId, "execution_completed", {
        executionId,
        agentId,
        tenantId,
        state: "completed",
        response: result.text,
        usage: result.usage,
        costUsd: result.costUsd,
        toolCalls: result.toolCalls,
        toolResults: result.toolResults,
        model: result.model,
        provider: result.provider,
      }, envelope);

      this.logger.log(
        `[execution] Completed: execution='${executionId ?? "n/a"}' agent='${agentId}' tokens=${result.usage.totalTokens}`,
      );
    } catch (error) {
      await this.publishStatus(tenantId, "execution_failed", {
        executionId,
        agentId,
        tenantId,
        state: "failed",
        error: error instanceof Error ? error.message : String(error),
      }, envelope);

      this.logger.error(
        `[execution] Failed: execution='${executionId ?? "n/a"}' agent='${agentId}': ${error}`,
      );
    }
  }

  private async publishStatus(
    tenantId: string,
    kind: string,
    data: Record<string, unknown>,
    incoming?: EventEnvelope,
  ): Promise<void> {
    try {
      const event = incoming
        ? deriveEnvelope(incoming, {
            id: crypto.randomUUID(),
            type: `io.yoizen.platform.runtime.${kind}.v1`,
            source: "agent-ai-service",
            resource: `execution/${data.executionId ?? "unknown"}`,
            payload: data,
          })
        : buildEventEnvelope({
            type: `io.yoizen.platform.runtime.${kind}.v1`,
            source: "agent-ai-service",
            resource: `execution/${data.executionId ?? "unknown"}`,
            tenant: tenantId,
            producer: "agent-ai-service",
            domain: "automation",
            channel: "platform",
            provider: "internal",
            accountid: "",
            payload: data,
          });

      const subject = `evt.${tenantId}.ai-agent-gateway.automation.platform.internal.${kind}.v1`;
      this.js.publish(subject, JSON.stringify(event));
    } catch (pubError) {
      this.logger.warn(
        `[execution] Failed to publish ${kind}: ${pubError}`,
      );
    }
  }
}
