import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { NATS_CONNECTION } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import {
  buildEventEnvelope,
  buildRuntimeStreamSubject,
  deriveEnvelope,
  type EventEnvelope,
  RUNTIME_TOKEN,
  RUNTIME_TOKEN_EVENT_TYPE,
  type RuntimeTokenPayload,
  type VariableResolutionContext,
} from "@yoizen/shared";
import type { JetStreamClient, Msg, NatsConnection } from "nats";
import { agentAiServiceConfig } from "../config";
import type { ChatRequest } from "../modules/chat/chat.dto";
// biome-ignore lint/style/useImportType: ChatService is constructor-injected by NestJS DI — must be a value import so `design:paramtypes` metadata resolves the real class at runtime, not `type`.
import { ChatService } from "../modules/chat/chat.service";
import { JETSTREAM } from "../providers/nats.provider";

@Injectable()
export class ExecutionHandler implements OnModuleInit {
  private readonly logger = new PinoLoggerService(ExecutionHandler.name);

  /**
   * One AbortController per in-flight streaming execution. Aborted when the
   * `cancel` control message arrives on `rt.<tenant>.exec.<id>.cancel`
   * (DOCS/architecture/runtime-streaming.md §2.2), or removed once the
   * execution reaches a terminal state.
   */
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly chatService: ChatService,
    @Inject(JETSTREAM) private readonly js: JetStreamClient,
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
  ) {}

  onModuleInit(): void {
    // Wildcard across every tenant/execution: rt.*.exec.*.cancel
    const wildcard = "rt.*.exec.*.cancel";
    this.nc.subscribe(wildcard, {
      callback: (error: Error | null, message: Msg) => {
        if (error) {
          this.logger.warn(`[execution] cancel subscription error: ${error}`);
          return;
        }
        this.handleCancelMessage(message);
      },
    });
    this.logger.log(
      `[execution] Subscribed to cancel control subject '${wildcard}'`
    );
  }

  private handleCancelMessage(message: Msg): void {
    // Subject shape: rt.<tenant>.exec.<executionId>.cancel
    const parts = message.subject.split(".");
    const executionId = parts[3];
    if (!executionId) {
      return;
    }

    const controller = this.abortControllers.get(executionId);
    if (!controller) {
      // Either already completed, or a cancel for an execution this
      // instance never started streaming — nothing to do.
      return;
    }
    this.logger.log(
      `[execution] Cancel received for execution='${executionId}'`
    );
    controller.abort();
  }

  async handle(
    tenantId: string,
    payload: Record<string, unknown>,
    envelope?: EventEnvelope
  ): Promise<void> {
    // Gateway wraps execution data in payload.input, support both formats
    const input = (payload.input ?? payload) as Record<string, unknown>;
    const executionId = (input.executionId ?? payload.executionId) as
      | string
      | undefined;
    const agentId = (input.agentId ?? payload.agentId) as string | undefined;
    const message = (input.message ?? payload.message) as string | undefined;
    const stream = Boolean(input.stream ?? payload.stream);

    if (!agentId || !message) {
      this.logger.warn(
        `[execution] Missing agentId or message for tenant '${tenantId}' execution='${executionId ?? "unknown"}'`
      );
      return;
    }

    const request: ChatRequest = {
      agentId,
      message,
      conversationId: (input.conversationId ?? payload.conversationId) as
        | string
        | undefined,
      sessionId: (input.sessionId ?? payload.sessionId) as string | undefined,
      chatId: (input.chatId ?? payload.chatId) as string | undefined,
      userId: (input.userId ?? payload.userId) as string | undefined,
      customerName: (input.customerName ?? payload.customerName) as
        | string
        | undefined,
      channel: (input.channel ?? payload.channel) as string | undefined,
      context: (input.context ?? payload.context) as ChatRequest["context"],
      metadata: (input.metadata ?? payload.metadata) as
        | Record<string, unknown>
        | undefined,
      variables: (input.variables ?? payload.variables) as
        | VariableResolutionContext
        | undefined,
    };

    if (stream && executionId) {
      await this.handleStreaming(
        tenantId,
        executionId,
        agentId,
        request,
        envelope
      );
      return;
    }

    await this.handleBuffered(
      tenantId,
      executionId,
      agentId,
      request,
      envelope
    );
  }

  private async handleBuffered(
    tenantId: string,
    executionId: string | undefined,
    agentId: string,
    request: ChatRequest,
    envelope?: EventEnvelope
  ): Promise<void> {
    this.logger.log(
      `[execution] Starting: tenant='${tenantId}' execution='${executionId ?? "n/a"}' agent='${agentId}'`
    );

    // Mirrors handleStreaming's cancel plumbing: an AbortController keyed
    // by executionId, aborted either by the shared `rt.*.exec.*.cancel`
    // subscription (onModuleInit) or by a wall-clock ceiling, so a caller
    // that gives up on `waitForExecutionResult` doesn't leave the LLM
    // burning compute with no consumer.
    const abortController = new AbortController();
    if (executionId) {
      this.abortControllers.set(executionId, abortController);
    }
    const timeoutHandle = setTimeout(() => {
      abortController.abort();
    }, agentAiServiceConfig.bufferedExecutionTimeoutMs);

    await this.publishStatus(
      tenantId,
      "execution_started",
      { executionId, agentId, tenantId, state: "started" },
      envelope
    );

    try {
      const result = await this.chatService.generateReply(tenantId, request, {
        abortSignal: abortController.signal,
      });

      await this.publishStatus(
        tenantId,
        "execution_completed",
        {
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
        },
        envelope
      );

      this.logger.log(
        `[execution] Completed: execution='${executionId ?? "n/a"}' agent='${agentId}' tokens=${result.usage.totalTokens}`
      );
    } catch (error) {
      const wasAborted = abortController.signal.aborted;
      await this.publishStatus(
        tenantId,
        "execution_failed",
        {
          executionId,
          agentId,
          tenantId,
          state: "failed",
          reason: wasAborted ? "cancelled" : undefined,
          error: error instanceof Error ? error.message : String(error),
        },
        envelope
      );

      this.logger.error(
        `[execution] Failed: execution='${executionId ?? "n/a"}' agent='${agentId}': ${error}`
      );
    } finally {
      clearTimeout(timeoutHandle);
      if (executionId) {
        this.abortControllers.delete(executionId);
      }
    }
  }

  /**
   * Streaming mode: iterates the AI SDK `textStream`, publishing a `token`
   * event per delta on the ephemeral `rt.<tenant>.exec.<id>.token` subject
   * (core NATS, not JetStream — DOCS/architecture/runtime-streaming.md §1.1,
   * §3.2). Lifecycle events (`execution_started/completed/failed`) keep
   * publishing on the existing JetStream `evt.` subject, unchanged.
   */
  private async handleStreaming(
    tenantId: string,
    executionId: string,
    agentId: string,
    request: ChatRequest,
    envelope?: EventEnvelope
  ): Promise<void> {
    this.logger.log(
      `[execution] Starting (stream): tenant='${tenantId}' execution='${executionId}' agent='${agentId}'`
    );

    const abortController = new AbortController();
    this.abortControllers.set(executionId, abortController);

    await this.publishStatus(
      tenantId,
      "execution_started",
      { executionId, agentId, tenantId, state: "started" },
      envelope
    );

    let seq = 0;
    let fullText = "";

    try {
      const streamResult = await this.chatService.generateStream(
        tenantId,
        request,
        {
          executionId,
          abortSignal: abortController.signal,
        }
      );

      for await (const delta of streamResult.textStream) {
        fullText += delta;
        this.publishToken(tenantId, executionId, agentId, seq, delta);
        seq += 1;
      }

      const usage = await streamResult.usage;

      await this.publishStatus(
        tenantId,
        "execution_completed",
        {
          executionId,
          agentId,
          tenantId,
          state: "completed",
          response: fullText,
          usage: {
            inputTokens: usage.inputTokens ?? 0,
            outputTokens: usage.outputTokens ?? 0,
            totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
          },
          costUsd: usage.costUsd ?? 0,
          model: streamResult.model,
          provider: streamResult.provider,
        },
        envelope
      );

      this.logger.log(
        `[execution] Completed (stream): execution='${executionId}' agent='${agentId}' tokens=${seq}`
      );
    } catch (error) {
      const wasAborted = abortController.signal.aborted;
      await this.publishStatus(
        tenantId,
        "execution_failed",
        {
          executionId,
          agentId,
          tenantId,
          state: "failed",
          reason: wasAborted ? "cancelled" : undefined,
          error: error instanceof Error ? error.message : String(error),
        },
        envelope
      );

      this.logger.log(
        wasAborted
          ? `[execution] Cancelled (stream): execution='${executionId}' agent='${agentId}'`
          : `[execution] Failed (stream): execution='${executionId}' agent='${agentId}': ${error}`
      );
    } finally {
      this.abortControllers.delete(executionId);
    }
  }

  private publishToken(
    tenantId: string,
    executionId: string,
    agentId: string,
    seq: number,
    delta: string
  ): void {
    try {
      const subject = buildRuntimeStreamSubject(
        tenantId,
        executionId,
        RUNTIME_TOKEN
      );
      const payload: RuntimeTokenPayload = {
        executionId,
        agentId,
        seq,
        delta,
        done: false,
      };
      const event = buildEventEnvelope({
        type: RUNTIME_TOKEN_EVENT_TYPE,
        source: "agent-ai-service",
        resource: `execution/${executionId}`,
        tenant: tenantId,
        producer: "agent-ai-service",
        domain: "automation",
        channel: "platform",
        provider: "internal",
        accountid: "ai-agent-gateway",
        payload: payload as unknown as Record<string, unknown>,
        correlationId: executionId,
        transport: { method: "stream", protocol: "internal" },
      });
      // Core NATS publish (not JetStream) — ephemeral, never persisted.
      this.nc.publish(subject, JSON.stringify(event));
    } catch (pubError) {
      this.logger.warn(
        `[execution] Failed to publish token seq=${seq}: ${pubError}`
      );
    }
  }

  private async publishStatus(
    tenantId: string,
    kind: string,
    data: Record<string, unknown>,
    incoming?: EventEnvelope
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
      this.logger.warn(`[execution] Failed to publish ${kind}: ${pubError}`);
    }
  }
}
